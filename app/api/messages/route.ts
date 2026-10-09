/**
 * Serves scoped inboxes and manager-authored employee messages.
 * Private messages remain visible only to sender and recipient; employees receive
 * broadcasts. Message content is never duplicated into security audit metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { changeMessage,editableMessage,employeeRoster,listMessages,readMessages,sendMessage } from "@/lib/collaboration"
import { encryptedMessageSchema,validateEnvelope } from "@/lib/message-envelope"
import { MESSAGE_EDIT_MINUTES } from "@/lib/message-policy"
import { recordAuditEvent } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { z } from "zod"
/**
 * Loads recent messages visible to the signed-in active account.
 * @returns Promise<Response> containing the authorized inbox.
 */
export async function GET(): Promise<Response> {
  const email = (await auth())?.user?.email
  const access = await getEffectivePermissions(email)
  if (!email || !access.role) return Response.json({error:"Forbidden."},{status:403})
  try {
    return Response.json({messages:await listMessages(email,access.role === "employee" || access.role === "contractor"),email:email.toLowerCase(),role:access.role,editMinutes:MESSAGE_EDIT_MINUTES},{headers:{"Cache-Control":"no-store"}})
  } catch { return Response.json({error:"Inbox unavailable."},{status:500}) }
}

/**
 * Acknowledges opened messages or edits a scoped message within the edit window.
 * @param req - Request with an explicit read action, legacy text, or signed encrypted edit.
 * @returns Promise<Response> containing acknowledgment or safe validation failure.
 */
export async function PATCH(req: Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role) return Response.json({error:"Forbidden."},{status:403})
    const input = z.discriminatedUnion("action", [
      z.object({action:z.literal("read"),ids:z.array(z.string().uuid()).min(1).max(100)}),
      z.object({action:z.literal("edit"),id:z.string().uuid(),body:z.string().trim().min(1).max(4000).optional(),encrypted:encryptedMessageSchema.optional()}),
    ]).parse(await req.json())
    if (input.action === "read") {
      await readMessages(email,access.role === "employee" || access.role === "contractor",input.ids)
      return Response.json({ok:true})
    }
    if (access.role !== "admin" && (!(access.role === "manager") || !access.permissions.send_messages)) return Response.json({error:"Forbidden."},{status:403})
    const original=await editableMessage(email,access.role==="admin",input.id)
    if(!original)return Response.json({error:"Message unavailable."},{status:409})
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
 * Deletes message content for all participants, preserving a lifecycle marker.
 * @param req - Request containing the message UUID; actor identity comes from auth.
 * @returns Promise<Response> indicating deletion or a safe authorization failure.
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role || (access.role !== "admin" && (access.role !== "manager" || !access.permissions.send_messages))) return Response.json({error:"Forbidden."},{status:403})
    const {id} = z.object({id:z.string().uuid()}).parse(await req.json())
    if (!await changeMessage(email,access.role === "admin",id,null)) return Response.json({error:"Message unavailable."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"message_deleted",targetType:"message",targetId:id,...getAuditContext(req)})
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
    if (!email || !(access.role === "admin" || access.role === "manager") || !access.permissions.send_messages) return Response.json({error:"Forbidden."},{status:403})
    const body = z.object({recipient:z.string().email().nullable(),encrypted:encryptedMessageSchema}).parse(await req.json())
    const roster=await employeeRoster()
    if (body.recipient && !roster.some(user=>user.email.toLowerCase() === body.recipient!.toLowerCase())) return Response.json({error:"Select an active employee."},{status:400})
    if(!await validateEnvelope(body.encrypted,email,email,body.recipient,[email,...(body.recipient?[body.recipient]:roster.map(user=>user.email))]))return Response.json({error:"Every recipient must set up encryption before sending."},{status:400})
    const id = await sendMessage(email,body.recipient,"[Encrypted message]",body.encrypted)
    await recordAuditEvent({actorEmail:email,action:"message_sent",targetType:"message",targetId:id,metadata:{broadcast:body.recipient === null},...getAuditContext(req)})
    return Response.json({id},{status:201})
  } catch(error) { return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid encrypted message request.":"Message could not be sent."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500}) }
}
