import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)
const initialize = createDatabaseInitializer()

export type OperationalEvent = {
  id: string
  correlationId: string
  actorEmail: string
  category: string
  operation: string
  route: string
  method: string | null
  httpStatus: number | null
  errorCode: string | null
  message: string
  requestId: string | null
  occurredAt: string
}

type OperationalEventRow = {
  id: string
  correlation_id: string
  actor_email: string
  category: string
  operation: string
  route: string
  method: string | null
  http_status: number | null
  error_code: string | null
  message: string
  request_id: string | null
  occurred_at: string | Date
}

const tableReady = createDatabaseInitializer()

export function ensureOperationalEventsTable() {
  return tableReady(async () => {
    await sql`CREATE TABLE IF NOT EXISTS operational_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      correlation_id uuid NOT NULL,
      actor_email text NOT NULL,
      category text NOT NULL,
      operation text NOT NULL,
      route text NOT NULL,
      method text,
      http_status integer,
      error_code text,
      message text NOT NULL DEFAULT '',
      request_id text,
      occurred_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS operational_events_occurred_idx ON operational_events (occurred_at DESC, id DESC)`
    await sql`CREATE INDEX IF NOT EXISTS operational_events_correlation_idx ON operational_events (correlation_id, occurred_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS operational_events_category_status_idx ON operational_events (category, http_status, occurred_at DESC)`
  })
}

function mapEvent(row: OperationalEventRow): OperationalEvent {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    actorEmail: row.actor_email,
    category: row.category,
    operation: row.operation,
    route: row.route,
    method: row.method,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    message: row.message,
    requestId: row.request_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
  }
}

export function sanitizeOperationalMessage(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 240)
}

export async function recordOperationalEvent(event: Omit<OperationalEvent, "id" | "occurredAt">) {
  await ensureOperationalEventsTable()
  const rows = await sql`INSERT INTO operational_events (
      correlation_id, actor_email, category, operation, route, method,
      http_status, error_code, message, request_id
    ) VALUES (
      ${event.correlationId}::uuid, ${event.actorEmail.toLowerCase()}, ${event.category},
      ${event.operation}, ${event.route}, ${event.method}, ${event.httpStatus},
      ${event.errorCode}, ${sanitizeOperationalMessage(event.message)}, ${event.requestId}
    ) RETURNING id, correlation_id, actor_email, category, operation, route,
      method, http_status, error_code, message, request_id, occurred_at`
  return mapEvent(rows[0] as OperationalEventRow)
}

export async function listOperationalEvents(options: {
  limit?: number
  from?: string
  through?: string
  category?: string
  search?: string
} = {}) {
  await ensureOperationalEventsTable()
  const limit = Math.min(Math.max(options.limit ?? 250, 1), 500)
  const rows = await sql`SELECT id, correlation_id, actor_email, category, operation,
      route, method, http_status, error_code, message, request_id, occurred_at
    FROM operational_events
    WHERE (${options.from ?? null}::date IS NULL OR occurred_at >= ${options.from ?? null}::date)
      AND (${options.through ?? null}::date IS NULL OR occurred_at < (${options.through ?? null}::date + interval '1 day'))
      AND (${options.category ?? null}::text IS NULL OR category = ${options.category ?? null})
      AND (${options.search ?? null}::text IS NULL OR concat_ws(' ',actor_email,operation,route,method,http_status,error_code,message,request_id,correlation_id::text) ILIKE ${options.search ? `%${options.search}%` : null})
    ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`
  return (rows as OperationalEventRow[]).map(mapEvent)
}

/** Loads a keyset page of filtered operational events across the full retention history. */
export async function listOperationalEventPage(options:{limit?:number;from?:string;through?:string;category?:string;search?:string;actor?:string;route?:string;method?:string;status?:number;beforeAt?:string;beforeId?:string}={}){
  await ensureOperationalEventsTable()
  const limit=Math.min(Math.max(options.limit??100,1),250)
  const rows=await sql`SELECT id,correlation_id,actor_email,category,operation,route,method,http_status,error_code,message,request_id,occurred_at
    FROM operational_events
    WHERE (${options.from??null}::date IS NULL OR occurred_at>=${options.from??null}::date)
      AND (${options.through??null}::date IS NULL OR occurred_at<(${options.through??null}::date+interval '1 day'))
      AND (${options.category??null}::text IS NULL OR category=${options.category??null})
      AND (${options.actor??null}::text IS NULL OR lower(actor_email)=lower(${options.actor??null}))
      AND (${options.route??null}::text IS NULL OR route ILIKE ${options.route?`%${options.route}%`:null})
      AND (${options.method??null}::text IS NULL OR method=${options.method??null})
      AND (${options.status??null}::integer IS NULL OR http_status=${options.status??null})
      AND (${options.search??null}::text IS NULL OR concat_ws(' ',actor_email,category,operation,route,method,http_status,error_code,message,request_id,correlation_id::text) ILIKE ${options.search?`%${options.search}%`:null})
      AND (${options.beforeAt??null}::timestamptz IS NULL OR (occurred_at,id)<(${options.beforeAt??null}::timestamptz,${options.beforeId??null}::uuid))
    ORDER BY occurred_at DESC,id DESC LIMIT ${limit+1}` as OperationalEventRow[]
  const hasMore=rows.length>limit
  const events=rows.slice(0,limit).map(mapEvent)
  const last=events.at(-1)
  return {events,nextCursor:hasMore&&last?{occurredAt:last.occurredAt,id:last.id}:null}
}

export async function listOperationalEventsByCorrelation(correlationId: string, limit = 50) {
  await ensureOperationalEventsTable()
  const safeLimit = Math.min(Math.max(limit, 1), 100)
  const rows = await sql`SELECT id, correlation_id, actor_email, category, operation,
      route, method, http_status, error_code, message, request_id, occurred_at
    FROM operational_events WHERE correlation_id = ${correlationId}::uuid
    ORDER BY occurred_at DESC, id DESC LIMIT ${safeLimit}`
  return (rows as OperationalEventRow[]).map(mapEvent)
}
