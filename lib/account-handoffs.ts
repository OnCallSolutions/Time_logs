/**
 * Stores reviewed contractor work assigned to a business-account reviewer.
 * Handoffs capture approved evidence without calculating or releasing payments.
 * Queue reads flag records whose source approval or revision is no longer current.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureTimeEntriesTable, ensureAuditEventsTable } from "./db"
import type { AuditContext } from "./audit"
import type { TimeEntry } from "./types"
import { createDatabaseInitializer } from "./database-initializer"
const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
export const accountTriageStates=["pending","needs_information","ready_for_finance","archived"] as const
export const accountReviewStates=[...accountTriageStates,"returned_to_manager","returned_to_submitter","payout_eligible"] as const
export type AccountReviewState=typeof accountReviewStates[number]
export type AccountHandoff={id:string;entry_id:string;assigned_to:string;handed_by:string;created_at:string;current:boolean;review_state:AccountReviewState;review_note:string;review_version:number;evidence:{contractor:string;ownerEmail:string;workerCategory?:"contractor"|"employee";date:string;hours:number;project:string;description:string;reviewedBy:string;reviewedAt:string}}

/** @returns Promise<void> after idempotent handoff storage and lookup indexes exist. */
async function ensureHandoffs(){
  await ensureTimeEntriesTable()
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS account_handoffs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_id uuid NOT NULL REFERENCES time_entries(id),
      assigned_to text NOT NULL,handed_by text NOT NULL,source_updated_at timestamptz NOT NULL,
      evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(entry_id,source_updated_at)
    )`
    await sql`CREATE INDEX IF NOT EXISTS account_handoffs_assignee_date_idx ON account_handoffs(assigned_to,created_at DESC)`
    await sql`ALTER TABLE account_handoffs ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending'
      CHECK(review_state IN ('pending','needs_information','ready_for_finance','archived')),
      ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_reviewed_by text,ADD COLUMN IF NOT EXISTS account_reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 0`
    await sql`ALTER TABLE account_handoffs ADD COLUMN IF NOT EXISTS review_checks jsonb NOT NULL DEFAULT '{}'::jsonb`
    await sql`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='account_handoffs'::regclass AND conname='account_handoffs_review_state_check' AND pg_get_constraintdef(oid) LIKE '%payout_eligible%') THEN
        ALTER TABLE account_handoffs DROP CONSTRAINT IF EXISTS account_handoffs_review_state_check;
        ALTER TABLE account_handoffs ADD CONSTRAINT account_handoffs_review_state_check CHECK(review_state IN ('pending','needs_information','ready_for_finance','archived','returned_to_manager','returned_to_submitter','payout_eligible'));
      END IF; END $$`
  })
}

/**
 * Captures approved entries with reviewer separation checked again in SQL.
 * @param ids - Validated contractor entries, bounded by the route to fifty.
 * @param actor - Authenticated handing-off reviewer.
 * @param recipient - Active account manager validated by the route.
 * @param includeAll - Whether server permissions permit team-wide entry visibility.
 * @returns Stored handoff identifiers, excluding duplicates and changed approvals.
 */
export async function createHandoffs(ids:string[],actor:string,recipient:string,includeAll:boolean,categories:Record<string,"contractor"|"employee">={}){
  await ensureHandoffs()
  return sql`INSERT INTO account_handoffs(entry_id,assigned_to,handed_by,source_updated_at,evidence)
    SELECT id,${recipient.toLowerCase()},${actor.toLowerCase()},updated_at,
      jsonb_build_object('contractor',contractor,'ownerEmail',owner_email,'workerCategory',COALESCE(${JSON.stringify(categories)}::jsonb->>id::text,'contractor'),'date',work_date,'hours',hours,'project',project,'description',description,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at)
    FROM time_entries WHERE id=ANY(${ids}::uuid[]) AND status='approved'
      AND payout_eligible_at IS NULL
      AND EXISTS(SELECT 1 FROM account_identities a WHERE lower(a.email)=lower(time_entries.owner_email))
      AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(owner_email)
      AND (${includeAll} OR lower(owner_email)=${actor.toLowerCase()})
    ON CONFLICT DO NOTHING RETURNING id,entry_id`
}

/**
 * Lists at most one hundred assigned handoffs with current-source validity.
 * @param email - Authenticated reviewer identity.
 * @param admin - Whether server-verified admin rights permit the complete queue.
 * @returns Scoped handoff snapshots; stale rows are not eligible for future release.
 */
export async function listHandoffs(email:string,admin:boolean,asSender=false){
  await ensureHandoffs()
  return await sql`SELECT h.id,h.entry_id,h.assigned_to,h.handed_by,h.evidence,h.created_at,h.review_state,h.review_note,h.review_version,
    (e.status='approved' AND e.updated_at=h.source_updated_at) AS current
    FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id
    WHERE ${admin} OR (${asSender} AND h.handed_by=${email.toLowerCase()}) OR (${!asSender} AND h.assigned_to=${email.toLowerCase()})
    ORDER BY h.created_at DESC LIMIT 100` as unknown as AccountHandoff[]
}

/**
 * Updates scoped triage state without approving or releasing money.
 * @param id - Selected handoff identifier.
 * @param actor - Authenticated account reviewer.
 * @param admin - Verified administrator scope.
 * @param state - Explicit triage decision.
 * @param note - Human review note.
 * @param version - Previously read review version for optimistic concurrency.
 * @returns Updated handoff ID/version, or null for stale/unauthorized evidence.
 */
export async function reviewHandoff(id:string,actor:string,admin:boolean,state:AccountReviewState,note:string,version:number):Promise<{id:string;review_version:number}|null>{
  await ensureHandoffs()
  const rows=await sql`UPDATE account_handoffs AS h SET review_state=${state},review_note=${note},account_reviewed_by=${actor.toLowerCase()},account_reviewed_at=now(),review_version=h.review_version+1
    FROM time_entries e WHERE h.entry_id=e.id AND h.id=${id} AND h.review_version=${version}
      AND h.review_state NOT IN ('payout_eligible','returned_to_manager','returned_to_submitter')
      AND ${state} IN ('pending','needs_information','ready_for_finance','archived')
      AND (${admin} OR h.assigned_to=${actor.toLowerCase()})
      AND (${state} <> 'ready_for_finance' OR (e.status='approved' AND e.updated_at=h.source_updated_at AND lower(e.owner_email)<>${actor.toLowerCase()}))
    RETURNING h.id,h.review_version`
  return rows.length?{id:String(rows[0].id),review_version:Number(rows[0].review_version)}:null
}

/**
 * Approves submitted evidence and forwards it to business accounts in one statement.
 * @param id - Submitted timesheet ID, already authorized by the route.
 * @param actor - Independent approving reviewer, never the evidence owner.
 * @param revision - Exact server-loaded revision to protect concurrent changes.
 * @param category - Effective owner role captured in the immutable handoff snapshot.
 * @param context - Audit context captured from the authenticated request.
 * @returns Promise<TimeEntry|null> after approval, handoff, and audit all succeed.
 */
export async function approveAndForward(id:string,actor:string,revision:string,category:string,context:AuditContext):Promise<TimeEntry|null>{
  await ensureHandoffs();await ensureAuditEventsTable()
  const rows=await sql`WITH changed AS (
    UPDATE time_entries SET status='approved',reviewed_by=${actor.toLowerCase()},reviewed_at=now(),review_note=NULL,updated_at=now()
    WHERE id=${id}::uuid AND status='submitted' AND updated_at=${revision}::timestamptz
      AND lower(owner_email)<>${actor.toLowerCase()} AND payout_eligible_at IS NULL
      AND EXISTS(SELECT 1 FROM account_identities a WHERE lower(a.email)=lower(time_entries.owner_email)) RETURNING *
  ), forwarded AS (
    INSERT INTO account_handoffs(entry_id,assigned_to,handed_by,source_updated_at,evidence)
    SELECT id,'business_accounts',${actor.toLowerCase()},updated_at,
      jsonb_build_object('contractor',contractor,'ownerEmail',owner_email,'workerCategory',${category}::text,'date',work_date,'hours',hours,'project',project,'description',description,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at)
    FROM changed RETURNING id,entry_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},'entry_approved','time_entry',entry_id::text,jsonb_build_object('handoffId',id,'forwardedToBusinessAccounts',true),${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM forwarded RETURNING target_id
  ) SELECT id,owner_email AS "ownerEmail",contractor_number AS "contractorNumber",contractor,work_date::text AS date,hours::float8 AS hours,project,description,status,
    reviewed_by AS "reviewedBy",reviewed_at::text AS "reviewedAt",review_note AS "reviewNote",review_manager_email AS "reviewManagerEmail",updated_at::text AS revision,false AS "reviewEligible",false AS "payoutEligible"
    FROM changed WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length?rows[0] as unknown as TimeEntry:null
}

export type AccountBatchAction = "return_manager" | "return_submitter" | "authorize_eligibility"
export type AccountChecks = { accuracy: boolean; compliance: boolean; housekeeping: boolean }

/**
 * Locks an entire selection, changes source/financial state, and audits atomically.
 * @param selection - Explicit handoff IDs and expected review versions, at most fifty.
 * @param actor - Authenticated business reviewer; eligibility never covers their own work.
 * @param action - Return to manager, return to submitter, or eligibility authorization.
 * @param note - Required human explanation, never AI-applied automatically.
 * @param checks - Explicit accuracy, compliance, and housekeeping acknowledgments.
 * @param manager - Active validated manager for a return-to-manager action.
 * @param context - Request metadata, stored only in the security audit table.
 * @returns Promise<number> equal to the complete selection or zero for any stale item.
 */
export async function actOnHandoffs(selection:{id:string;version:number}[],actor:string,action:AccountBatchAction,note:string,checks:AccountChecks,manager:string|null,context:AuditContext):Promise<number>{
  if(!selection.length||selection.length>100||new Set(selection.map(row=>row.id)).size!==selection.length)return 0
  await ensureHandoffs();await ensureAuditEventsTable()
  const ready=checks.accuracy&&checks.compliance&&checks.housekeeping
  const state=action==="return_manager"?"returned_to_manager":action==="return_submitter"?"returned_to_submitter":"payout_eligible"
  const rows=await sql`WITH requested AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(selection)}::jsonb) AS x(id uuid,version integer)
  ), locked AS MATERIALIZED (
    SELECT h.id,h.entry_id,h.review_version,h.review_state,h.source_updated_at,e.owner_email,e.status,e.updated_at,e.payout_eligible_at,r.version
    FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id JOIN requested r ON r.id=h.id
    ORDER BY h.id FOR UPDATE OF h,e
  ), eligible AS (
    SELECT * FROM locked WHERE review_version=version AND status='approved' AND updated_at=source_updated_at
      AND payout_eligible_at IS NULL AND review_state IN ('pending','needs_information','ready_for_finance')
      AND (${action}<>'authorize_eligibility' OR (${ready} AND lower(owner_email)<>${actor.toLowerCase()}))
      AND (${action}<>'return_manager' OR (${manager}::text IS NOT NULL AND lower(owner_email)<>lower(${manager}::text)))
  ), changed_entries AS (
    UPDATE time_entries e SET status=CASE WHEN ${action}='return_manager' THEN 'submitted' WHEN ${action}='return_submitter' THEN 'rejected' ELSE e.status END,
      review_note=CASE WHEN ${action}<>'authorize_eligibility' THEN ${note} ELSE e.review_note END,
      reviewed_by=CASE WHEN ${action}<>'authorize_eligibility' THEN NULL ELSE e.reviewed_by END,
      reviewed_at=CASE WHEN ${action}<>'authorize_eligibility' THEN NULL ELSE e.reviewed_at END,
      review_manager_email=CASE WHEN ${action}='return_manager' THEN lower(${manager}::text) ELSE e.review_manager_email END,
      payout_eligible_at=CASE WHEN ${action}='authorize_eligibility' THEN now() ELSE e.payout_eligible_at END,
      payout_eligible_by=CASE WHEN ${action}='authorize_eligibility' THEN ${actor.toLowerCase()} ELSE e.payout_eligible_by END,
      updated_at=CASE WHEN ${action}<>'authorize_eligibility' THEN now() ELSE e.updated_at END
    FROM eligible x WHERE e.id=x.entry_id AND (SELECT count(*) FROM eligible)=${selection.length} RETURNING e.id
  ), changed_handoffs AS (
    UPDATE account_handoffs h SET review_state=${state},review_note=${note},review_checks=${JSON.stringify(checks)}::jsonb,
      account_reviewed_by=${actor.toLowerCase()},account_reviewed_at=now(),review_version=h.review_version+1
    FROM eligible x JOIN changed_entries e ON e.id=x.entry_id WHERE h.id=x.id RETURNING h.id
  ) INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},${action==="authorize_eligibility"?"account_eligibility_authorized":"account_timesheets_returned"},'account_handoff',id::text,
      jsonb_build_object('state',${state}::text,'note',${note}::text,'checks',${JSON.stringify(checks)}::jsonb,'manager',${manager}::text,'eligibilityOnly',true),${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM changed_handoffs RETURNING target_id`
  return rows.length
}
