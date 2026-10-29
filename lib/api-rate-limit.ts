/** Applies a durable per-account minute bucket to costly AI endpoints. */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import { getAuditContext } from "@/lib/audit"
import { recordAuditEvent } from "@/lib/db"

const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()

async function ensureRateLimitTable():Promise<void>{
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS api_rate_limits(
      actor_email text NOT NULL,endpoint text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL DEFAULT 0,
      PRIMARY KEY(actor_email,endpoint))`
  })
}

/** @param email - Authenticated account identity. @param endpoint - Stable endpoint label. @param limit - Maximum requests in one minute. @param request - Request context used only for a threshold-crossing audit event. @returns Allowed state and observed request count. */
export async function checkApiRateLimit(email:string,endpoint:string,limit:number,request:Request):Promise<{allowed:boolean;hits:number}>{
  await ensureRateLimitTable()
  const rows=await sql`INSERT INTO api_rate_limits(actor_email,endpoint,window_start,hits)
    VALUES(${email.toLowerCase()},${endpoint},date_trunc('minute',now()),1)
    ON CONFLICT(actor_email,endpoint) DO UPDATE SET
      window_start=CASE WHEN api_rate_limits.window_start<date_trunc('minute',now()) THEN date_trunc('minute',now()) ELSE api_rate_limits.window_start END,
      hits=CASE WHEN api_rate_limits.window_start<date_trunc('minute',now()) THEN 1 ELSE api_rate_limits.hits+1 END
    RETURNING hits`
  const hits=Number(rows[0]?.hits??0)
  if(hits===limit+1){
    await recordAuditEvent({actorEmail:email,action:"api_rate_limit_exceeded",targetType:"api_endpoint",targetId:endpoint,metadata:{limit,windowSeconds:60},...getAuditContext(request)}).catch(()=>undefined)
  }
  return {allowed:hits<=limit,hits}
}
