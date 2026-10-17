/**
 * Executes one explicitly confirmed, signed action using existing business handlers.
 * Authentication, live permissions and record revisions are rechecked at execution.
 * Nonces are consumed before dispatch; uncertain outcomes require refresh, not replay.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { canOfferAction } from "@/lib/assistant-contract"
import { claimAssistantAction, readAssistantRequest, verifyAssistantAction } from "@/lib/assistant-security"
import { PATCH as updateEntry } from "@/app/api/entries/[id]/route"
import { POST as createEntries } from "@/app/api/entries/route"
import { listAccountIdentities } from "@/lib/account-identities"
import { DELETE as deleteEntry } from "@/app/api/entries/[id]/route"
import { GET as getEntries } from "@/app/api/entries/route"
import { PATCH as updateMessage, DELETE as removeMessage } from "@/app/api/messages/route"
import { PATCH as updateAdminRights, GET as readAdminDirectory } from "@/app/api/users/route"
import { PATCH as updateDelegatedRights } from "@/app/api/delegation/route"

/** @param request - Confirmation containing only an immutable signed token. @returns Promise<Response> with confirmed result or a safe retry instruction. */
export async function POST(request: Request): Promise<Response> {
  let input
  try { input = z.object({ token: z.string().max(100_000) }).strict().parse(await readAssistantRequest(request, 110_000)) }
  catch { return Response.json({ error: "Invalid action confirmation." }, { status: 400 }) }
  try {
    const session = await auth(), email = session?.user?.email, sid = session?.appSessionId
    if (!email || !sid) return Response.json({ error: "Sign in again." }, { status: 401 })
    let proposal
    try { proposal = verifyAssistantAction(input.token, email, sid) }
    catch { return Response.json({ error: "This action expired or changed. Ask the assistant for a new proposal." }, { status: 409 }) }
    const access = await getEffectivePermissions(email), action = proposal.action
    if (!canOfferAction(action, access)) return Response.json({ error: "Your current permissions do not allow this action." }, { status: 403 })
    if (!await claimAssistantAction(proposal.id, email, action.kind)) return Response.json({ error: "This action was already attempted. Refresh before asking for another proposal." }, { status: 409 })
    const headers = new Headers(request.headers); headers.set("content-type", "application/json");headers.delete("content-length");headers.delete("transfer-encoding")
    if (action.kind === "update_entry") {
      const { kind, id, ...patch } = action
      // Do not clear the assigned reviewer when the model did not select a new one.
      const body = { ...patch, ...(patch.reviewManagerEmail === null ? { reviewManagerEmail: undefined } : {}) }
      return await updateEntry(new Request(request.url, { method: "PATCH", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
    }
    if (action.kind === "create_entries") {
      const identity = (await listAccountIdentities([email]))[0]
      const entries = action.entries.map(entry => ({ ...entry, contractor: identity?.officialName || session.user?.name || email }))
      return await createEntries(new Request(request.url, { method: "POST", headers, body: JSON.stringify({ entries }) }))
    }
    if(action.kind==="edit_entry"){
      const {kind,id,expectedRevision,fields}=action
      return await updateEntry(new Request(request.url,{method:"PATCH",headers,body:JSON.stringify({...fields,expectedRevision})}),{params:Promise.resolve({id})})
    }
    if(action.kind==="delete_entry"){
      const current=await getEntries()
      if(!current.ok)return Response.json({error:"Refresh the entry list before deleting."},{status:503})
      const rows=(await current.json() as {entries:Array<{id:string;revision?:string}>}).entries
      if(!rows.some(row=>row.id===action.id&&row.revision===action.expectedRevision))return Response.json({error:"This entry changed. Ask for a fresh proposal before deleting."},{status:409})
      return await deleteEntry(new Request(request.url,{method:"DELETE",headers}),{params:Promise.resolve({id:action.id})})
    }
    if(action.kind==="mark_messages_read")return await updateMessage(new Request(request.url,{method:"PATCH",headers,body:JSON.stringify({action:"read",ids:action.ids})}))
    if(action.kind==="delete_message")return await removeMessage(new Request(request.url,{method:"DELETE",headers,body:JSON.stringify({id:action.id})}))
    if(action.kind==="update_rights"){
      if(access.role==="manager")return await updateDelegatedRights(new Request(request.url,{method:"PATCH",headers,body:JSON.stringify({email:action.email,permissions:action.permissions})}))
      const directory=await readAdminDirectory()
      if(!directory.ok)return Response.json({error:"Refresh the employee directory before changing rights."},{status:503})
      const target=(await directory.json() as {users:Array<{email:string;role:string;accessStatus:string;note?:string}>}).users.find(user=>user.email.toLowerCase()===action.email.toLowerCase())
      if(!target||!["admin","manager","account_manager","employee","contractor"].includes(target.role)||!["active","denied","suspended","retired","blocked"].includes(target.accessStatus))return Response.json({error:"That active directory record could not be confirmed."},{status:409})
      return await updateAdminRights(new Request(request.url,{method:"PATCH",headers,body:JSON.stringify({email:target.email,role:target.role,accessStatus:target.accessStatus,note:target.note??"",permissions:action.permissions})}))
    }
    return Response.json({ clientAction: action }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    console.error("[assistant] action outcome unconfirmed")
    return Response.json({ error: "The action could not be confirmed. Refresh the workspace before trying again." }, { status: 503 })
  }
}
