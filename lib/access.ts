/**
 * Centralizes role and allowlist resolution for authenticated users.
 *
 * The app supports both environment-backed recovery access and database-backed
 * admin-managed access. Keeping the parsing and precedence rules in this module
 * lets server pages and API routes make the same authorization decision.
 */
import "server-only"

import { getManagedAccessUser } from "@/lib/db"
import { getAccountLifecycle } from "@/lib/access-lifecycle-store"
import { lifecycleDeniesAccess } from "@/lib/access-lifecycle-policy"
import type { UserRole } from "@/lib/types"

/**
 * Converts a comma-separated email environment variable into normalized emails.
 *
 * Normalization is intentionally strict and predictable: whitespace is trimmed,
 * casing is lowered, and blank entries caused by trailing commas are discarded.
 * The returned list can be compared directly against Microsoft account emails.
 *
 * @param value - Optional comma-separated email list from an environment variable.
 * @returns Lowercase, trimmed email addresses with empty items removed.
 */
function parseEmailList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Returns the general allowlist emails configured for the app.
 *
 * The general allowlist grants baseline "contractor" access without assigning manager
 * or admin capabilities. Role-specific lists are handled separately so elevated
 * privileges remain explicit.
 *
 * @returns Email addresses listed in ALLOWED_EMAILS.
 */
export function getAllowedEmails() {
  return [...new Set([
    ...parseEmailList(process.env.ALLOWED_EMAILS),
    ...parseEmailList(process.env.CONTRACTOR_EMAILS),
  ])]
}

/**
 * Returns the configured email list for a specific app role.
 *
 * Each role is backed by a separate environment variable. The function keeps the
 * mapping between role names and variables in one place so route handlers do not
 * need to know the specific variable names.
 *
 * @param role - Role whose environment-backed email list should be read.
 * @returns Email addresses configured for the requested role.
 */
function getRoleEmails(role: UserRole) {
  if (role === "admin") return parseEmailList(process.env.ADMIN_EMAILS)
  if (role === "manager") return parseEmailList(process.env.MANAGER_EMAILS)
  if (role === "account_manager") return parseEmailList(process.env.ACCOUNT_MANAGER_EMAILS)
  if (role === "employee") {
    return [
      ...parseEmailList(process.env.EMPLOYEE_EMAILS),
      // Backward compatibility for deployments configured before the rename.
      ...parseEmailList(process.env.WORKER_EMAILS),
    ]
  }
  return []
}

/**
 * Lists every email explicitly configured in environment-backed access policy.
 *
 * The result is intended for administrator visibility screens. It applies the
 * same role precedence as getUserRole so duplicate emails appear once with the
 * highest configured access level.
 *
 * @returns Configured emails with their effective environment-backed role.
 */
export function getConfiguredAccessUsers() {
  const users = new Map<string, UserRole>()

  for (const role of ["admin", "manager", "account_manager", "employee"] as const) {
    for (const email of getRoleEmails(role)) {
      if (!users.has(email)) {
        users.set(email, role)
      }
    }
  }

  for (const email of getAllowedEmails()) {
    if (!users.has(email)) {
      users.set(email, "contractor")
    }
  }

  return Array.from(users.entries()).map(([email, role]) => ({ email, role }))
}

/**
 * Checks whether any environment-backed access lists are configured.
 *
 * When no environment lists and no managed rows are relevant, the app can remain
 * open to authenticated users. Once env policy exists, it acts as an explicit
 * allowlist unless a managed active assignment grants access.
 *
 * @returns True when at least one environment access list has entries.
 */
function hasEnvironmentAccessPolicy() {
  return (
    getAllowedEmails().length > 0 ||
    getRoleEmails("admin").length > 0 ||
    getRoleEmails("manager").length > 0 ||
    getRoleEmails("account_manager").length > 0 ||
    getRoleEmails("employee").length > 0
  )
}

/**
 * Resolves the explicit role assigned to a signed-in email.
 *
 * Role checks are ordered from highest privilege to lowest privilege. If an email
 * appears in multiple lists, the highest matching role wins so administrators do
 * not lose capabilities because of a broader allowlist entry.
 *
 * @param email - Signed-in user's email address.
 * @returns The configured role for the email, or null when not configured.
 */
export function getUserRole(email?: string | null): UserRole | null {
  if (!email) return null

  const normalizedEmail = email.toLowerCase()

  if (getRoleEmails("admin").includes(normalizedEmail)) return "admin"
  if (getRoleEmails("manager").includes(normalizedEmail)) return "manager"
  if (getRoleEmails("account_manager").includes(normalizedEmail)) return "account_manager"
  if (getRoleEmails("employee").includes(normalizedEmail)) return "employee"
  if (getAllowedEmails().includes(normalizedEmail)) return "contractor"

  return null
}

/**
 * Resolves a user's role, falling back to the base user role when allowed.
 *
 * This is the safest helper for UI and API code because it converts approved but
 * non-elevated users into the base "contractor" role. A null return means the caller
 * should treat the request as unauthorized.
 *
 * @param email - Signed-in user's email address.
 * @returns The effective role for the email, or null when access is denied.
 */
export async function getEffectiveUserRole(
  email?: string | null,
): Promise<UserRole | null> {
  if (!email) return null

  const normalizedEmail = email.toLowerCase()
  const environmentRole = getUserRole(normalizedEmail)

  if (environmentRole === "admin") {
    return "admin"
  }

  const managedAccess = await getManagedAccessUser(normalizedEmail)
  // Administrators remain outside automatic lifecycle changes to preserve recovery.
  if(managedAccess?.role!=="admin"&&lifecycleDeniesAccess(await getAccountLifecycle(normalizedEmail)))return null

  if (managedAccess) {
    return managedAccess.accessStatus === "active"
      ? managedAccess.role
      : null
  }

  if (environmentRole) {
    return environmentRole
  }

  return hasEnvironmentAccessPolicy() ? null : "contractor"
}

/**
 * Checks whether an email can access the app under the configured allowlists.
 *
 * When no allowlist variables are configured, the app remains open to any
 * authenticated Microsoft user. Once any list is configured, access becomes
 * explicit and the email must appear in one of the approved lists.
 *
 * @param email - Signed-in user's email address.
 * @returns True when the email is allowed or no allowlists are configured.
 */
export async function isAllowedEmail(email?: string | null) {
  return (await getEffectiveUserRole(email)) !== null
}
