import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listOperationalEventPage } from "@/lib/operational-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const email = (await auth())?.user?.email ?? null
    if (await getEffectiveUserRole(email) !== "admin") {
      return Response.json({ error: "Forbidden." }, { status: 403 })
    }
    const params = new URL(request.url).searchParams
    const from = params.get("from") || undefined
    const through = params.get("through") || undefined
    const category = params.get("category") || undefined
    const search = params.get("search")?.trim().slice(0, 100) || undefined
    const actor=params.get("actor")?.trim().slice(0,254)||undefined
    const route=params.get("route")?.trim().slice(0,160)||undefined
    const method=params.get("method")?.toUpperCase()||undefined
    const statusRaw=params.get("status")||undefined
    const beforeAt=params.get("beforeAt")||undefined
    const beforeId=params.get("beforeId")||undefined
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if(Boolean(beforeAt)!==Boolean(beforeId)||beforeAt&&(!Number.isFinite(Date.parse(beforeAt))||!uuid.test(beforeId!)))return Response.json({error:"Invalid operational-event cursor."},{status:400})
    if(method&&!['GET','POST','PUT','PATCH','DELETE'].includes(method))return Response.json({error:"Invalid method filter."},{status:400})
    const status=statusRaw?Number(statusRaw):undefined
    if(statusRaw&&(status===undefined||!Number.isInteger(status)||status<400||status>599))return Response.json({error:"Invalid response-status filter."},{status:400})
    const isDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value
    if ((from && !isDate(from)) || (through && !isDate(through)) || (from && through && from > through)) {
      return Response.json({ error: "Invalid operational-event filters." }, { status: 400 })
    }
    const requestedLimit = Number(params.get("limit") ?? "250")
    const page = await listOperationalEventPage({
      limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit,1),250) : 100,
      from,
      through,
      category,
      search,
      actor,route,method,status,beforeAt,beforeId,
    })
    return Response.json(page, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Operational events could not be loaded." }, { status: 503 })
  }
}
