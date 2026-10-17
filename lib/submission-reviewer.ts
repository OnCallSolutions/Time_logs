/**
 * Resolves a company's authorized manager for an employee or contractor's
 * timesheet. Prefer the active manager who provisioned the account; until
 * self-registration assignment is configured by an administrator, use the
 * first active manager who has both review and team-view rights.
 */
import "server-only"
import { getAccountIdentityCreator } from "@/lib/account-identities"
import { actorRoster } from "@/lib/collaboration"
import { getEffectivePermissions } from "@/lib/effective-permissions"

export type SubmissionReviewer={email:string;displayName:string;assignment:"added_by_manager"|"available_manager"}

/** @param ownerEmail - Authenticated employee/contractor account. @returns Promise<SubmissionReviewer|null> with its locked submission reviewer. */
export async function resolveSubmissionReviewer(ownerEmail:string):Promise<SubmissionReviewer|null>{
  const owner=ownerEmail.toLowerCase()
  const [creator,roster]=await Promise.all([getAccountIdentityCreator(owner),actorRoster()])
  const candidates=await Promise.all(roster
    .filter(actor=>actor.role==="manager"&&actor.accessStatus==="active"&&actor.email.toLowerCase()!==owner)
    .map(async actor=>{
      const access=await getEffectivePermissions(actor.email)
      return access.role==="manager"&&access.permissions.review_entries&&access.permissions.view_team
        ? {email:actor.email.toLowerCase(),displayName:actor.displayName||actor.email,assignment:"available_manager" as const}
        : null
    }))
  const managers=candidates.filter(actor=>actor!==null)
    .sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email))
  if(!managers.length)return null
  const addedBy=managers.find(manager=>manager.email===creator?.toLowerCase())
  return addedBy?{...addedBy,assignment:"added_by_manager"}:managers[0]
}
