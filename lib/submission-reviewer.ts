/**
 * Resolves the assigned reviewer for employee and contractor submissions.
 * The enabled account manager is the default operational reviewer; otherwise
 * prefer the active manager who provisioned the account, then a stable fallback.
 */
import "server-only"
import { getAccountIdentityCreator } from "@/lib/account-identities"
import { actorRoster } from "@/lib/collaboration"
import { getEffectivePermissions } from "@/lib/effective-permissions"

export type SubmissionReviewer={email:string;displayName:string;assignment:"added_by_manager"|"available_manager"}

/** Resolves the active operational manager who owns a patron's project relationship. */
export async function resolvePatronManager(ownerEmail:string):Promise<Pick<SubmissionReviewer,"email"|"displayName">|null>{
  const owner=ownerEmail.toLowerCase()
  const [creator,roster]=await Promise.all([getAccountIdentityCreator(owner),actorRoster()])
  const candidates=await Promise.all(roster
    .filter(actor=>actor.role==="manager"&&actor.accessStatus==="active"&&actor.email.toLowerCase()!==owner)
    .map(async actor=>{
      const access=await getEffectivePermissions(actor.email)
      return access.role==="manager"&&access.permissions.review_entries&&access.permissions.view_team
        ?{email:actor.email.toLowerCase(),displayName:actor.displayName||actor.email}
        :null
    }))
  const managers=candidates.filter((candidate):candidate is {email:string;displayName:string}=>candidate!==null)
    .sort((a,b)=>Number(b.email===creator?.toLowerCase())-Number(a.email===creator?.toLowerCase())||a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email))
  return managers[0]??null
}

/** @param ownerEmail - Authenticated employee/contractor account. @returns Promise<SubmissionReviewer|null> with its locked submission reviewer. */
export async function resolveSubmissionReviewer(ownerEmail:string):Promise<SubmissionReviewer|null>{
  const owner=ownerEmail.toLowerCase()
  const [creator,roster]=await Promise.all([getAccountIdentityCreator(owner),actorRoster()])
  const candidates=await Promise.all(roster
    .filter(actor=>(actor.role==="manager"||actor.role==="account_manager")&&actor.accessStatus==="active"&&actor.email.toLowerCase()!==owner)
    .map(async actor=>{
      const access=await getEffectivePermissions(actor.email)
      const eligible=access.role==="manager"
        ? access.permissions.review_entries&&access.permissions.view_team
        : access.role==="account_manager"&&access.permissions.review_entries
      return eligible
        ? {email:actor.email.toLowerCase(),displayName:actor.displayName||actor.email,assignment:"available_manager" as const,role:access.role}
        : null
    }))
  const managers=candidates.filter(actor=>actor!==null)
    .sort((a,b)=>Number(b.role==="account_manager")-Number(a.role==="account_manager")||a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email))
  if(!managers.length)return null
  if(managers[0].role==="account_manager"){
    const {role:_,...reviewer}=managers[0]
    return reviewer
  }
  const addedBy=managers.find(manager=>manager.email===creator?.toLowerCase())
  const selected=addedBy??managers[0]
  const {role:_,...reviewer}=selected
  return addedBy?{...reviewer,assignment:"added_by_manager"}:reviewer
}

/** Resolves an active account manager for patron deadline-extension decisions. */
export async function resolveAccountManagerReviewer(ownerEmail:string):Promise<SubmissionReviewer|null>{
  const owner=ownerEmail.toLowerCase()
  const roster=await actorRoster()
  const candidates=await Promise.all(roster
    .filter(actor=>actor.role==="account_manager"&&actor.accessStatus==="active"&&actor.email.toLowerCase()!==owner)
    .map(async actor=>{
      const access=await getEffectivePermissions(actor.email)
      return access.role==="account_manager"&&access.permissions.review_entries
        ?{email:actor.email.toLowerCase(),displayName:actor.displayName||actor.email,assignment:"available_manager" as const}
        :null
    }))
  return candidates.filter((candidate):candidate is {email:string;displayName:string;assignment:"available_manager"}=>candidate!==null)
    .sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email))[0]??null
}
