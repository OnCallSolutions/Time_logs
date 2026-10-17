import "server-only"
import { neon } from "@neondatabase/serverless"
import { getAuditContext } from "@/lib/audit"
import { ensureAssistantStorage } from "@/lib/assistant-security"
import { ensureAccountHandoffStorage } from "@/lib/account-handoffs"
import { ensureAuditEventsTable, ensureEntryRejectionArchiveTable, ensureTimeEntriesTable } from "@/lib/db"
import { ensureReviewRequestStorage } from "@/lib/review-requests"
import { ensureReminders } from "@/lib/timesheet-period-reminders"

const sql=neon(process.env.DATABASE_URL!)

/** Clears preview timesheets and operational history while preserving identity, periods, messages, and finance snapshots. */
export async function resetPreviewData(actorEmail:string,request:Request):Promise<Record<string,number>>{
  await Promise.all([ensureTimeEntriesTable(),ensureAuditEventsTable(),ensureEntryRejectionArchiveTable(),ensureReviewRequestStorage(),ensureReminders(),ensureAccountHandoffStorage(),ensureAssistantStorage()])
  await sql`CREATE TABLE IF NOT EXISTS security_reports (
    run_day DATE PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),
    assessment JSONB,model TEXT NOT NULL,event_count INTEGER NOT NULL,possibly_truncated BOOLEAN NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ
  )`
  const context=getAuditContext(request)
  const results=await sql.transaction([
    sql`WITH deleted AS (DELETE FROM entry_review_requests RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM time_entries RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM entry_rejection_archive RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM security_reports RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM assistant_runs RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM assistant_executions RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM timesheet_period_reminders RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`WITH deleted AS (DELETE FROM audit_events RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
    sql`INSERT INTO audit_events(actor_email,action,target_type,metadata,ip_address,user_agent,request_method,request_path,request_id)
      VALUES(${actorEmail.toLowerCase()},'preview_data_reset','organization',${JSON.stringify({environment:"preview",resetMarker:true,financeHandoffsPreserved:true,identitiesAndPeriodsPreserved:true})}::jsonb,
        ${context.ipAddress??null},${context.userAgent??null},${context.requestMethod??"POST"},${context.requestPath??"/api/admin/preview-reset"},${context.requestId??null})`,
  ])
  const names=["reviewRequests","timesheets","rejectionHistory","securityReports","assistantRuns","assistantActions","deadlineReminders","auditEvents"]
  const counts=Object.fromEntries(names.map((name,index)=>[name,Number((results[index] as Array<{count:number}>)[0]?.count??0)]))
  return counts
}
