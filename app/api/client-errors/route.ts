/** Stores sanitized, authenticated UI failure reports for technology diagnostics. */
import {z} from "zod"
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {getAuditContext} from "@/lib/audit"
import {recordAuditEvent} from "@/lib/db"
import {recordOperationalEvent,sanitizeOperationalMessage} from "@/lib/operational-events"
import {readJsonLimited,RequestBodyTooLargeError} from "@/lib/read-json-limited"

export const runtime="nodejs"
const inputSchema=z.object({
  reference:z.string().uuid(),
  operation:z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/i),
  route:z.string().regex(/^\/[a-zA-Z0-9/_\-[\]]{1,160}$/),
  method:z.enum(["GET","POST","PUT","PATCH","DELETE"]).optional(),
  status:z.number().int().min(400).max(599).optional(),
  code:z.string().regex(/^[A-Z0-9_.-]{1,40}$/).optional(),
  message:z.string().max(400),
}).strict()

export async function POST(request:Request){
  try{
    if(Number(request.headers.get("content-length")??0)>8192)return Response.json({error:"Report is too large."},{status:413})
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const input=inputSchema.parse(await readJsonLimited(request,8192))
    const context=getAuditContext(request)
    const message=sanitizeOperationalMessage(input.message)
    await recordOperationalEvent({correlationId:input.reference,actorEmail:email,category:"client_error",operation:input.operation,route:input.route,method:input.method??null,httpStatus:input.status??null,errorCode:input.code??null,message,requestId:context.requestId})
    await recordAuditEvent({actorEmail:email,action:"client_error_reported",targetType:"client_error",targetId:input.reference,metadata:{operation:input.operation,route:input.route,httpMethod:input.method??null,errorCode:input.code??null,httpStatus:input.status??null,message},...context})
    return Response.json({accepted:true},{status:202,headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const tooLarge=error instanceof RequestBodyTooLargeError
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    return Response.json({error:tooLarge?"Report is too large.":invalid?"Invalid error report.":"Error report could not be recorded."},{status:tooLarge?413:invalid?400:503})
  }
}
