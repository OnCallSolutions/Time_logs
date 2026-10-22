/**
 * Provides administrator-only access to recent security audit events.
 *
 * Audit records include who performed sensitive actions, what target was changed,
 * request context, and sanitized metadata. The route is read-only and restricted
 * to admins to preserve confidentiality of the security timeline.
 */
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listAuditEventPage,listAuditEventsByCorrelation } from "@/lib/db"
import {listOperationalEventsByCorrelation} from "@/lib/operational-events"

export const runtime = "nodejs"

/**
 * Returns recent audit events for administrator review.
 *
 * The optional limit query parameter is clamped inside the database helper, which
 * keeps the endpoint available even if a caller requests an excessive number of
 * events.
 *
 * @param req - Incoming request with optional limit query parameter.
 * @returns JSON response containing recent audit events or an error.
 */
export async function GET(req: Request) {
  try {
    const session = await auth()
    const email = session?.user?.email ?? null
    const role = await getEffectiveUserRole(email)

    if (role !== "admin") {
      return Response.json({ error: "Forbidden." }, { status: 403 })
    }

    const url = new URL(req.url)
    const correlationId=url.searchParams.get("correlationId")
    if(correlationId){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId))return Response.json({error:"Invalid correlation reference."},{status:400})
      const [auditEvents,operationalEvents]=await Promise.all([listAuditEventsByCorrelation(correlationId),listOperationalEventsByCorrelation(correlationId)])
      const diagnosticEvents=operationalEvents.map(event=>({
        id:event.id,actorEmail:event.actorEmail,action:"operational_failure",targetType:event.category,targetId:event.correlationId,
        metadata:{operation:event.operation,route:event.route,httpMethod:event.method,httpStatus:event.httpStatus,errorCode:event.errorCode,message:event.message},
        ipAddress:null,userAgent:null,requestMethod:event.method,requestPath:event.route,requestId:event.requestId,occurredAt:event.occurredAt,
      }))
      return Response.json({events:[...auditEvents,...diagnosticEvents].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))},{headers:{"Cache-Control":"no-store"}})
    }
    const limit = Number(url.searchParams.get("limit") ?? "100")
    const beforeAt=url.searchParams.get("beforeAt")??undefined
    const beforeId=url.searchParams.get("beforeId")??undefined
    const from=url.searchParams.get("from")||undefined
    const through=url.searchParams.get("through")||undefined
    const search=url.searchParams.get("search")?.trim().slice(0,100)||undefined
    const actor=url.searchParams.get("actor")?.trim().slice(0,254)||undefined
    const action=url.searchParams.get("action")?.trim().slice(0,80)||undefined
    const targetType=url.searchParams.get("targetType")?.trim().slice(0,80)||undefined
    const scope=url.searchParams.get("scope")||undefined
    if(scope&&!['access','periods','projects'].includes(scope))return Response.json({error:"Invalid audit report scope."},{status:400})
    const isDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value
    if((from&&!isDate(from))||(through&&!isDate(through))||(from&&through&&from>through))return Response.json({error:"Invalid audit filters."},{status:400})
    if(Boolean(beforeAt)!==Boolean(beforeId)||beforeAt&&(!Number.isFinite(Date.parse(beforeAt))||!beforeId||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId)))return Response.json({error:"Invalid audit cursor."},{status:400})
    if(beforeAt){
      const page=await listAuditEventPage({limit:Number.isFinite(limit)?limit:250,beforeAt,beforeId,from,through,search,actor,action,targetType,scope})
      return Response.json(page,{headers:{"Cache-Control":"no-store"}})
    }
    const page=await listAuditEventPage({limit:Number.isFinite(limit)?limit:250,from,through,search,actor,action,targetType,scope})
    return Response.json(page,{headers:{"Cache-Control":"no-store"}})
  } catch (err) {
    console.error("[audit] list failed")
    return Response.json(
      { error: "Failed to load audit events." },
      { status: 500 },
    )
  }
}
