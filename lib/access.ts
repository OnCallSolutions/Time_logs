/**
 * Centralizes role and allowlist resolution for authenticated users.
 *
 * The app stores access policy in comma-separated environment variables rather
 * than in the database. Keeping the parsing and precedence rules in this module
 * lets server pages and API routes make the same authorization decision.
 */
import "server-only"

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
 * The general allowlist grants baseline "user" access without assigning manager
 * or admin capabilities. Role-specific lists are handled separately so elevated
 * privileges remain explicit.
 *
 * @returns Email addresses listed in ALLOWED_EMAILS.
 */
export function getAllowedEmails() {
  return parseEmailList(process.env.ALLOWED_EMAILS)
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
  if (role === "worker") return parseEmailList(process.env.WORKER_EMAILS)
  return []
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
  if (getRoleEmails("worker").includes(normalizedEmail)) return "worker"
  if (getAllowedEmails().includes(normalizedEmail)) return "user"

  return null
}

/**
 * Resolves a user's role, falling back to the base user role when allowed.
 *
 * This is the safest helper for UI and API code because it converts approved but
 * non-elevated users into the base "user" role. A null return means the caller
 * should treat the request as unauthorized.
 *
 * @param email - Signed-in user's email address.
 * @returns The effective role for the email, or null when access is denied.
 */
export function getEffectiveUserRole(email?: string | null): UserRole | null {
  return getUserRole(email) ?? (isAllowedEmail(email) ? "user" : null)
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
export function isAllowedEmail(email?: string | null) {
  const accessConfigured =
    getAllowedEmails().length > 0 ||
    getRoleEmails("admin").length > 0 ||
    getRoleEmails("manager").length > 0 ||
    getRoleEmails("worker").length > 0

  if (!accessConfigured) {
    return true
  }

  return getUserRole(email) !== null
}
