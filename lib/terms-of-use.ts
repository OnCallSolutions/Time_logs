/** Persists versioned patron terms acknowledgements and immutable audit events. */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import { getAuditContext } from "@/lib/audit"
import { recordAuditEvent } from "@/lib/db"
import { CURRENT_TERMS_VERSION } from "@/lib/terms-constants"

const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
async function ensureTermsTable():Promise<void>{
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS terms_acceptances(
      email text PRIMARY KEY,version text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT now(),ip_address text,user_agent text)`
  })
}

export async function hasAcceptedCurrentTerms(email:string):Promise<boolean>{
  await ensureTermsTable()
  const rows=await sql`SELECT 1 FROM terms_acceptances WHERE email=${email.toLowerCase()} LIMIT 1`
  return rows.length>0
}

export async function acceptCurrentTerms(email:string,request:Request):Promise<void>{
  await ensureTermsTable()
  const context=getAuditContext(request),actor=email.toLowerCase()
  await sql`INSERT INTO terms_acceptances(email,version,ip_address,user_agent)
    VALUES(${actor},${CURRENT_TERMS_VERSION},${context.ipAddress},${context.userAgent})
    ON CONFLICT(email) DO UPDATE SET version=EXCLUDED.version,accepted_at=now(),ip_address=EXCLUDED.ip_address,user_agent=EXCLUDED.user_agent`
  await recordAuditEvent({actorEmail:actor,action:"terms_of_use_accepted",targetType:"terms_of_use",targetId:CURRENT_TERMS_VERSION,metadata:{version:CURRENT_TERMS_VERSION},...context})
}
