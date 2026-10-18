/**
 * Serves scoped inboxes and manager-authored employee messages.
 * Private messages remain visible only to sender and recipient; employees receive
 * broadcasts. Message content is never duplicated into security audit metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { changeMessage,editableMessage,actorRoster,hideMessageFor,listMessages,readMessages,sendMessage,getMessagePreferences,setReadReceiptsEnabled,setOwnMessageAlignment } from "@/lib/collaboration"
import { audienceEmails,messageAudiences } from "@/lib/message-audience"
import { encryptedMessageSchema,validateEnvelope } from "@/lib/message-envelope"
import { MESSAGE_EDIT_MINUTES } from "@/lib/message-policy"
import { recordAuditEvent } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { z } from "zod"
import { listAccountIdentities } from "@/lib/account-identities"
import { historyPage,historyByIds } from "@/lib/message-history-store"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
/**
 * Loads recent messages visible to the signed-in active account.
 * @returns Promise<Response> containing the authorized inbox.
 */
export async function GET(request?:Request): Promise<Response> {
  const email = (await auth())?.user?.email
  const access = await getEffectivePermissions(email)
  if (!email || !access.role) return Response.json({error:"Forbidden."},{status:403})
  try {
    const params=request?new URL(request.url).searchParams:null
    const cursor=params?.get("before")
    const ids=params?.get("ids")?z.array(z.string().uuid()).min(1).max(100).parse(JSON.parse(params.get("ids")!)):null
    const before=cursor?z.object({date:z.string().datetime({offset:true}),id:z.string().uuid()}).parse(JSON.parse(cursor)):null
    const [messages,preferences]=await Promise.all([ids?historyByIds(email,ids,access.role === "employee" || access.role === "contractor"):before?historyPage(email,before,access.role === "employee" || access.role === "contractor"):listMessages(email,access.role === "employee" || access.role === "contractor"),getMessagePreferences(email)])
    const identities=await listAccountIdentities(messages.flatMap(message=>[message.sender_email,message.recipient_email,message.encrypted_payload?.author].filter((value):value is string=>typeof value==="string")))
    const official=new Map(identities.map(person=>[person.email,person.officialName]))
    const last=messages.at(-1)
    return Response.json({messages:messages.map(message=>({...message,sender_name:message.sender_email.toLowerCase()===email.toLowerCase()?"You":official.get(String(message.sender_email))??"Unknown sender",recipient_name:official.get(String(message.recipient_email))??(message.recipient_email?"Unknown recipient":"All recipients"),author_name:official.get(String(message.encrypted_payload?.author))??"Unknown sender"})),readReceiptsEnabled:preferences.readReceiptsEnabled,ownMessageAlignment:preferences.ownMessageAlignment,next:messages.length===(before?50:100)&&last?{date:String(last.created_at),id:last.id}:null,email:email.toLowerCase(),role:access.role,editMinutes:MESSAGE_EDIT_MINUTES},{headers:{"Cache-Control":"no-store"}})
  } catch (error) { console.error("[messages] inbox load failed",persistenceFailureDetails(error));return Response.json({error:"Inbox unavailable."},{status:500}) }
}

/**
 * Acknowledges, locally hides, or edits a scoped message.
 * @param req - Request with an explicit read, delete-for-me, or encrypted-edit action.
 * @returns Promise<Response> containing acknowledgment or safe validation failure.
 */
export async function PATCH(req: Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role) return Response.json({error:"Forbidden."},{status:403})
    const input = z.discriminatedUnion("action", [
      z.object({action:z.literal("read"),ids:z.array(z.string().uuid()).min(1).max(100)}),
      z.object({action:z.literal("read_receipts"),enabled:z.boolean()}),
      z.object({action:z.literal("own_message_alignment"),alignment:z.enum(["left","right"])}),
      z.object({action:z.literal("delete_for_me"),id:z.string().uuid()}),
      z.object({action:z.literal("edit"),id:z.string().uuid(),body:z.string().trim().min(1).max(4000).optional(),encrypted:encryptedMessageSchema.optional()}),
    ]).parse(await req.json())
    if (input.action === "read") {
      await readMessages(email,access.role === "employee" || access.role === "contractor",input.ids)
      return Response.json({ok:true})
    }
    if(input.action==="read_receipts"){
      await setReadReceiptsEnabled(email,input.enabled)
      await recordAuditEvent({actorEmail:email,action:"message_read_receipts_updated",targetType:"account",targetId:email.toLowerCase(),metadata:{enabled:input.enabled},...getAuditContext(req)})
      return Response.json({ok:true,readReceiptsEnabled:input.enabled})
    }
    if(input.action==="own_message_alignment"){
      await setOwnMessageAlignment(email,input.alignment)
      await recordAuditEvent({actorEmail:email,action:"message_alignment_updated",targetType:"account",targetId:email.toLowerCase(),metadata:{alignment:input.alignment},...getAuditContext(req)})
      return Response.json({ok:true,ownMessageAlignment:input.alignment})
    }
    if(input.action==="delete_for_me"){
      const hidden=await hideMessageFor(email,access.role==="employee"||access.role==="contractor",input.id)
      if(!hidden)return Response.json({error:"Message unavailable or already hidden."},{status:409})
      await recordAuditEvent({actorEmail:email,action:"message_deleted_for_me",targetType:"message",targetId:input.id,...getAuditContext(req)})
      return Response.json({ok:true,scope:"me"})
    }
    if (access.role !== "admin" && (!(access.role === "manager") || !access.permissions.send_messages)) return Response.json({error:"Forbidden."},{status:403})
    const original=await editableMessage(email,input.id)
    if(!original)return Response.json({error:"Message unavailable."},{status:409})
    if(String(original.sender_email).toLowerCase()!==email.toLowerCase())return Response.json({error:"Only the original sender can edit this message."},{status:403})
    if(original.encrypted_payload && !input.encrypted)return Response.json({error:"Encrypted messages cannot be saved as plaintext."},{status:400})
    if(input.encrypted){
      if(!original.encrypted_payload)return Response.json({error:"Legacy messages require a separate encryption migration."},{status:400})
      const participants=Object.keys(original.encrypted_payload.keys)
      if(!await validateEnvelope(input.encrypted,email,original.sender_email,original.recipient_email,participants))return Response.json({error:"Invalid encrypted message identity."},{status:400})
    }else if(!input.body)return Response.json({error:"Message body required."},{status:400})
    if (!await changeMessage(email,access.role === "admin",input.id,input.body??"[Encrypted message]",input.encrypted)) return Response.json({error:"Message unavailable or the one-hour edit window has expired."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"message_edited",targetType:"message",targetId:input.id,...getAuditContext(req)})
    return Response.json({ok:true})
  } catch (error) { return Response.json({error:error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid message request." : "Message update unavailable."},{status:error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500}) }
}

/**
 * Unsends a message for all participants, preserving a lifecycle marker.
 * @param req - Request containing the message UUID; actor identity comes from auth.
 * @returns Promise<Response> indicating deletion or a safe authorization failure.
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role || (access.role !== "admin" && (access.role !== "manager" || !access.permissions.send_messages))) return Response.json({error:"Forbidden."},{status:403})
    const {id} = z.object({id:z.string().uuid()}).parse(await req.json())
    if (!await changeMessage(email,access.role === "admin",id,null)) return Response.json({error:"Only the sender may unsend within one hour; administrators may moderate a message."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"message_unsent_for_everyone",targetType:"message",targetId:id,...getAuditContext(req)})
    return Response.json({ok:true})
  } catch (error) { return Response.json({error:error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid message request." : "Message deletion unavailable."},{status:error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500}) }
}
/**
 * Sends a validated message to one active employee or all employees.
 * @param req - Request with a recipient email/null and signed encrypted payload.
 * @returns Promise<Response> containing the saved message ID or safe failure.
 */
export async function POST(req:Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role || !access.permissions.send_messages) return Response.json({error:"Forbidden."},{status:403})
    const raw=await req.json() as {recipient?:unknown;audience?:unknown}|null
    const requestedAudience=raw?.audience??(typeof raw?.recipient==="string"?"individual":"workforce")
    if(access.role!=="admin"&&access.role!=="manager"&&(requestedAudience!=="individual"||typeof raw?.recipient!=="string"))return Response.json({error:"Only administrators and managers can send group announcements."},{status:403})
    const body = z.object({recipient:z.string().email().nullable(),audience:z.enum(messageAudiences).optional(),encrypted:encryptedMessageSchema}).parse(raw)
    const audience=body.audience??(body.recipient?"individual":"workforce")
    if((audience==="individual")!==!!body.recipient)return Response.json({error:"Choose an individual or a group, not both."},{status:400})
    const recipients=audienceEmails(await actorRoster(),audience,body.recipient)
    if(!recipients.length)return Response.json({error:"Select an audience with active recipients."},{status:400})
    if(!await validateEnvelope(body.encrypted,email,email,body.recipient,[email,...recipients]))return Response.json({error:"Every recipient must set up encryption before sending."},{status:400})
    const id = await sendMessage(email,body.recipient,"[Encrypted message]",body.encrypted)
    await recordAuditEvent({actorEmail:email,action:"message_sent",targetType:"message",targetId:id,metadata:{broadcast:body.recipient === null,audience,recipientCount:recipients.length},...getAuditContext(req)})
    return Response.json({id},{status:201})
  } catch(error) { if(!(error instanceof z.ZodError)&&!(error instanceof SyntaxError))console.error("[messages] send failed",persistenceFailureDetails(error));return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid encrypted message request.":"Message could not be sent."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500}) }
}
