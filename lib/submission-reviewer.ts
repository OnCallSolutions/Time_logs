/** Resolves the first independent reviewer for a submitted timesheet. */
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
  const ownerRole=roster.find(actor=>actor.email.toLowerCase()===owner)?.role
  const managerPersonalSheet=ownerRole==="manager"
  const candidates=await Promise.all(roster
    .filter(actor=>actor.role===(managerPersonalSheet?"account_manager":"manager")&&actor.accessStatus==="active"&&actor.email.toLowerCase()!==owner)
    .map(async actor=>{
      const access=await getEffectivePermissions(actor.email)
      const eligible=managerPersonalSheet
        ? access.role==="account_manager"&&access.permissions.review_entries&&access.permissions.review_manager_entries&&access.permissions.view_manager_entries
        : access.role==="manager"&&access.permissions.review_entries&&access.permissions.view_team
      return eligible
        ? {email:actor.email.toLowerCase(),displayName:actor.displayName||actor.email,assignment:"available_manager" as const}
        : null
    }))
  const managers=candidates.filter((candidate):candidate is {email:string;displayName:string;assignment:"available_manager"}=>candidate!==null)
    .sort((a,b)=>Number(b.email===creator?.toLowerCase())-Number(a.email===creator?.toLowerCase())||a.displayName.localeCompare(b.displayName)||a.email.localeCompare(b.email))
  const selected=managers[0]
  return selected?{...selected,assignment:!managerPersonalSheet&&selected.email===creator?.toLowerCase()?"added_by_manager":"available_manager"}:null
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
