/**
 * Provides an administrator-only directory of configured and active users.
 *
 * The route combines environment-backed access policy, admin-managed access
 * assignments, and users known through saved profiles or owned time entries.
 * Administrators can add people, assign roles, and deny or block access here.
 */
import { z } from "zod"
import { auth } from "@/auth"
import {
  getConfiguredAccessUsers,
  getEffectiveUserRole,
} from "@/lib/access"
import { getAuditContext } from "@/lib/audit"
import {
  getManagedAccessUser,
  listKnownUsers,
  listManagedAccessUsers,
  recordAuditEvent,
  upsertManagedAccessUser,
} from "@/lib/db"
import type { AccessStatus, UserRole } from "@/lib/types"
import { permissionLabels, type PermissionOverrides } from "@/lib/permissions"

export const runtime = "nodejs"

type DirectoryUser = {
  permissions?: PermissionOverrides
  /** Normalized user email used as the directory identity key. */
  email: string
  /** Effective environment-backed role, or none for observed unconfigured users. */
  role: UserRole | "none"
  /** Access state assigned by admins or inferred from environment access. */
  accessStatus: AccessStatus | "observed"
  /** Where this access row comes from. */
  accessSource: "managed" | "environment" | "observed"
  /** Whether this email appears in the configured allowlist or role variables. */
  accessConfigured: boolean
  /** Optional administrator note for managed access decisions. */
  note: string
  /** Email of the administrator who last changed managed access. */
  updatedBy: string | null
  /** ISO timestamp for the latest managed access update. */
  updatedAt: string | null
  /** Persisted profile display name, when available. */
  displayName: string
  /** Persisted profile image data URL, when available. */
  imageDataUrl: string | null
  /** Total number of entries owned by this user. */
  totalEntries: number
  /** Number of owned draft entries. */
  draftEntries: number
  /** Number of owned entries waiting for manager review. */
  submittedEntries: number
  /** Number of owned entries approved by a manager or admin. */
  approvedEntries: number
  /** Number of owned entries rejected by a manager or admin. */
  rejectedEntries: number
  /** ISO timestamp for the user's most recently created entry. */
  lastEntryAt: string | null
}

const accessUpdateSchema = z.object({
  permissions: z.partialRecord(z.enum(Object.keys(permissionLabels) as [keyof typeof permissionLabels, ...(keyof typeof permissionLabels)[]]), z.boolean()).optional(),
  email: z.string().trim().email(),
  role: z.enum(["admin", "manager", "employee", "user"]),
  accessStatus: z.enum(["active", "denied", "blocked"]).default("active"),
  note: z.string().trim().max(500).default(""),
})

/**
 * Resolves the signed-in caller as an administrator.
 *
 * Every user-management mutation and directory read goes through this guard so
 * employee and manager accounts cannot enumerate or change access assignments.
 *
 * @returns Admin caller email, or null when the request is forbidden.
 */
async function getAdminEmail() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = await getEffectiveUserRole(email)

  return email && role === "admin" ? email : null
}

/**
 * Converts a directory role into a seniority rank.
 *
 * Admins are most senior, followed by managers, employees, users, and observed
 * accounts without an assigned role.
 *
 * @param role - Directory role to rank.
 * @returns Numeric rank used for descending seniority ordering.
 */
function roleSeniority(role: DirectoryUser["role"]) {
  if (role === "admin") return 4
  if (role === "manager") return 3
  if (role === "employee") return 2
  if (role === "user") return 1
  return 0
}

/**
 * Orders directory users from highest to lowest seniority.
 *
 * Ties are ordered by normalized email so the response remains stable between
 * reloads and after access edits.
 *
 * @param users - Directory rows to sort.
 * @returns New array sorted by role seniority and email.
 */
function sortDirectoryUsers(users: DirectoryUser[]) {
  return [...users].sort((a, b) => {
    const seniorityDelta = roleSeniority(b.role) - roleSeniority(a.role)
    if (seniorityDelta !== 0) return seniorityDelta
    return a.email.localeCompare(b.email)
  })
}

/**
 * Returns the user directory for administrators.
 *
 * Admin authorization is checked from the signed-in session before any directory
 * data is returned. Known database users, configured environment users, and
 * managed access users are merged by normalized email.
 *
 * @returns JSON response containing merged user directory rows or an error.
 */
export async function GET() {
  try {
    const adminEmail = await getAdminEmail()

    if (!adminEmail) {
      return Response.json({ error: "Forbidden." }, { status: 403 })
    }

    const knownUsers = await listKnownUsers()
    const configuredUsers = getConfiguredAccessUsers()
    const managedUsers = await listManagedAccessUsers()
    const directory = new Map<string, DirectoryUser>()

    for (const user of knownUsers) {
      const normalizedEmail = user.email.toLowerCase()
      const effectiveRole = await getEffectiveUserRole(normalizedEmail)
      directory.set(normalizedEmail, {
        ...user,
        email: normalizedEmail,
        role: effectiveRole ?? "none",
        accessStatus: effectiveRole ? "active" : "observed",
        accessSource: "observed",
        accessConfigured: false,
        note: "",
        updatedBy: null,
        updatedAt: null,
      })
    }

    for (const user of configuredUsers) {
      const normalizedEmail = user.email.toLowerCase()
      const existing = directory.get(normalizedEmail)
      directory.set(normalizedEmail, {
        email: normalizedEmail,
        role: user.role,
        accessStatus: "active",
        accessSource: "environment",
        accessConfigured: true,
        note: existing?.note ?? "",
        updatedBy: existing?.updatedBy ?? null,
        updatedAt: existing?.updatedAt ?? null,
        displayName: existing?.displayName ?? "",
        imageDataUrl: existing?.imageDataUrl ?? null,
        totalEntries: existing?.totalEntries ?? 0,
        draftEntries: existing?.draftEntries ?? 0,
        submittedEntries: existing?.submittedEntries ?? 0,
        approvedEntries: existing?.approvedEntries ?? 0,
        rejectedEntries: existing?.rejectedEntries ?? 0,
        lastEntryAt: existing?.lastEntryAt ?? null,
      })
    }

    for (const user of managedUsers) {
      const normalizedEmail = user.email.toLowerCase()
      const existing = directory.get(normalizedEmail)
      directory.set(normalizedEmail, {
        email: normalizedEmail,
        role: user.role,
        accessStatus: user.accessStatus,
        accessSource: "managed",
        accessConfigured: true,
        note: user.note,
        permissions: user.permissions,
        updatedBy: user.updatedBy,
        updatedAt: user.updatedAt,
        displayName: existing?.displayName ?? "",
        imageDataUrl: existing?.imageDataUrl ?? null,
        totalEntries: existing?.totalEntries ?? 0,
        draftEntries: existing?.draftEntries ?? 0,
        submittedEntries: existing?.submittedEntries ?? 0,
        approvedEntries: existing?.approvedEntries ?? 0,
        rejectedEntries: existing?.rejectedEntries ?? 0,
        lastEntryAt: existing?.lastEntryAt ?? null,
      })
    }

    return Response.json({
      users: sortDirectoryUsers(Array.from(directory.values())),
    })
  } catch (err) {
    console.error("[users] directory failed")
    return Response.json(
      { error: "Failed to load user directory." },
      { status: 500 },
    )
  }
}

/**
 * Creates or replaces a managed access assignment.
 *
 * Administrators use this endpoint to add employees or other users from the app
 * UI. The saved assignment immediately participates in sign-in authorization.
 *
 * @param req - Request containing email, role, access status, and optional note.
 * @returns JSON response containing the saved access assignment.
 */
export async function POST(req: Request) {
  return saveManagedAccess(req)
}

/**
 * Updates a managed access assignment.
 *
 * The app uses PATCH from the explicit access editor window, but the operation
 * is an upsert so admins can recover if a row was not previously created.
 *
 * @param req - Request containing email, role, access status, and optional note.
 * @returns JSON response containing the saved access assignment.
 */
export async function PATCH(req: Request) {
  return saveManagedAccess(req)
}

/**
 * Persists an admin-managed access decision and records it in the audit trail.
 *
 * @param req - Request containing the access assignment payload.
 * @returns JSON response containing the saved access assignment or an error.
 */
async function saveManagedAccess(req: Request) {
  try {
    const adminEmail = await getAdminEmail()
    if (!adminEmail) {
      return Response.json({ error: "Forbidden." }, { status: 403 })
    }

    const body = accessUpdateSchema.parse(await req.json())
    const email = body.email.toLowerCase()
    if (email === adminEmail.toLowerCase() && body.accessStatus !== "active") {
      return Response.json(
        { error: "Admins cannot deny or block their own account." },
        { status: 400 },
      )
    }

    const existing = await getManagedAccessUser(email)
    const user = await upsertManagedAccessUser({
      email,
      role: body.role,
      accessStatus: body.accessStatus,
      note: body.note,
      permissions: body.permissions ?? existing?.permissions ?? {},
      updatedBy: adminEmail,
    })

    await recordAuditEvent({
      actorEmail: adminEmail,
      action: existing ? "user_access_updated" : "user_access_created",
      targetType: "managed_user_access",
      targetId: email,
      metadata: {
        fromRole: existing?.role ?? null,
        toRole: user.role,
        fromStatus: existing?.accessStatus ?? null,
        toStatus: user.accessStatus,
        noteChanged: existing?.note !== user.note,
        permissionsChanged: JSON.stringify(existing?.permissions ?? {}) !== JSON.stringify(user.permissions),
      },
      ...getAuditContext(req),
    })

    return Response.json({ user })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid access settings. Use valid roles, permission names, and boolean permission values." },
        { status: 400 },
      )
    }
    console.error("[users] access save failed")
    return Response.json(
      { error: "Failed to save user access." },
      { status: 500 },
    )
  }
}
