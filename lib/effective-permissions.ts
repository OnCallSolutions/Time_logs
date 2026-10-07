/**
 * Resolves live administrator-managed rights for server routes and UI refreshes.
 * Database access state and roles remain authoritative on every operation.
 * Technical administration stays restricted to administrator accounts.
 */
import "server-only"
import { getEffectiveUserRole } from "@/lib/access"
import { getManagedAccessUser } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"

/**
 * Reads current role and persisted rights for the authenticated identity.
 * @param email - Authenticated email, never an identity supplied in request JSON.
 * @returns Promise containing the current role and effective control permissions.
 */
export async function getEffectivePermissions(email?: string | null) {
  const role = await getEffectiveUserRole(email)
  const managed = email && role ? await getManagedAccessUser(email) : null
  return {role,permissions:resolvePermissions(role,managed?.permissions ?? {})}
}
