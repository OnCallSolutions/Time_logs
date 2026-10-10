/**
 * Defines explicit message audiences independently of UI labels and SQL storage.
 * Membership uses active server-resolved roles; the sender is added by encryption.
 * Legacy broadcasts default to internal employees and contractors.
 */
export const messageAudiences=["workforce","everyone","contractor","employee","manager","admin","individual"] as const
export type MessageAudience=typeof messageAudiences[number]

/**
 * Selects active recipients matching an explicit group or individual identity.
 * @param users - Server-resolved roster or its client projection.
 * @param audience - Requested recipient category.
 * @param recipient - Individual email, used only in individual mode.
 * @returns Normalized, deduplicated participant emails.
 */
export function audienceEmails(users:{email:string;role:string;accessStatus?:string}[],audience:MessageAudience,recipient:string|null):string[] {
  return [...new Set(users.filter(user=>(!user.accessStatus||user.accessStatus==="active")&&(
    audience==="individual"?user.email.toLowerCase()===recipient?.toLowerCase():
    audience==="everyone"?true:audience==="workforce"?user.role==="employee"||user.role==="contractor":user.role===audience
  )).map(user=>user.email.toLowerCase()))]
}
