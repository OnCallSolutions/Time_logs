/**
 * Defines time-bound account access and operational assignment policy.
 * Deadlines are evaluated on requests, not dependent on cron execution.
 * Technical and financial permissions are excluded from temporary assignments.
 */
import type { PermissionOverrides } from "./permissions"
export const temporaryPermissions=["create_entries","edit_entries","delete_entries","submit_entries","review_entries","view_team","view_reports"] as const
export type TemporaryPermission=typeof temporaryPermissions[number]
export type AccountLifecycle={email:string;cutoffAt:string|null;suspended:boolean;reviewAt:string|null;reason:string;updatedBy:string|null}
export type TemporaryAssignment={id:string;email:string;permissions:TemporaryPermission[];scope:"own"|"all";startsAt:string;endsAt:string;grantedBy:string;reason:string;revokedAt:string|null}

/**
 * Determines whether an account is suspended or has reached its cutoff.
 * @param lifecycle - Persisted state, or null for accounts without a schedule.
 * @param now - Current UTC epoch milliseconds, injectable for tests.
 * @returns boolean indicating denial, including malformed persisted cutoff values.
 */
export function lifecycleDeniesAccess(lifecycle:AccountLifecycle|null,now=Date.now()):boolean{
  if(!lifecycle)return false
  if(lifecycle.suspended)return true
  if(!lifecycle.cutoffAt)return false
  const cutoff=Date.parse(lifecycle.cutoffAt)
  return !Number.isFinite(cutoff)||now>=cutoff
}

/**
 * Combines only currently active, supported operational grants.
 * @param grants - Scoped assignments loaded for the authenticated account.
 * @param now - Current UTC epoch milliseconds, injectable for expiry tests.
 * @returns PermissionOverrides; callers apply permanent explicit denials afterward.
 */
export function activeTemporaryRights(grants:TemporaryAssignment[],now=Date.now()):PermissionOverrides{
  const rights:PermissionOverrides={}
  for(const grant of grants){
    const start=Date.parse(grant.startsAt),end=Date.parse(grant.endsAt)
    if(grant.revokedAt||!Number.isFinite(start)||!Number.isFinite(end)||now<start||now>=end)continue
    for(const permission of grant.permissions){
      if(!temporaryPermissions.includes(permission))continue
      if(grant.scope==="own"&&!["create_entries","edit_entries","delete_entries","submit_entries"].includes(permission))continue
      rights[permission]=true
    }
  }
  return rights
}
