/**
 * Resolves live administrator-managed rights for server routes and UI refreshes.
 * Database access state and roles remain authoritative on every operation.
 * Technical administration stays restricted to administrator accounts.
 */
import "server-only"
import { getEffectiveUserRole } from "@/lib/access"
import { getManagedAccessUser } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { getTemporaryAssignments } from "@/lib/access-lifecycle-store"
import { activeTemporaryRights } from "@/lib/access-lifecycle-policy"

/**
 * Reads current role and persisted rights for the authenticated identity.
 * @param email - Authenticated email, never an identity supplied in request JSON.
 * @returns Promise containing the current role and effective control permissions.
 */
export async function getEffectivePermissions(email?: string | null) {
  const role = await getEffectiveUserRole(email)
  const managed = email && role ? await getManagedAccessUser(email) : null
  const assignments=email&&role&&role!=="admin"&&role!=="account_manager"?await getTemporaryAssignments(email):[]
  const authorized=[]
  for(const assignment of assignments){
    const grantorRole=await getEffectiveUserRole(assignment.grantedBy)
    if(grantorRole!=="admin"&&grantorRole!=="manager")continue
    const grantor=await getManagedAccessUser(assignment.grantedBy)
    const rights=resolvePermissions(grantorRole,grantor?.permissions??{})
    authorized.push({...assignment,permissions:assignment.permissions.filter(permission=>grantorRole==="admin"||rights[permission])})
  }
  const temporary=activeTemporaryRights(authorized)
  return {role,permissions:resolvePermissions(role,{...temporary,...managed?.permissions})}
}
