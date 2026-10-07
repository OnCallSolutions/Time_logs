/**
 * Serves scoped inboxes and manager-authored employee messages.
 * Private messages remain visible only to sender and recipient; employees receive
 * broadcasts. Message content is never duplicated into security audit metadata.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { employeeRoster,listMessages,sendMessage } from "@/lib/collaboration"
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
  return Response.json({messages:await listMessages(email,access.role === "employee" || access.role === "user")},{headers:{"Cache-Control":"no-store"}})
}
/**
 * Sends a validated message to one active employee or all employees.
 * @param req - Request with a recipient email/null and plain-text body.
 * @returns Promise<Response> containing the saved message ID or safe failure.
 */
export async function POST(req:Request): Promise<Response> {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !(access.role === "admin" || access.role === "manager") || !access.permissions.send_messages) return Response.json({error:"Forbidden."},{status:403})
    const body = z.object({recipient:z.string().email().nullable(),body:z.string().trim().min(1).max(4000)}).parse(await req.json())
    if (body.recipient && !(await employeeRoster()).some(user=>user.email.toLowerCase() === body.recipient!.toLowerCase())) return Response.json({error:"Select an active employee."},{status:400})
    const id = await sendMessage(email,body.recipient,body.body)
    await recordAuditEvent({actorEmail:email,action:"message_sent",targetType:"message",targetId:id,metadata:{broadcast:body.recipient === null},...getAuditContext(req)})
    return Response.json({id},{status:201})
  } catch { return Response.json({error:"Message could not be sent."},{status:400}) }
}
