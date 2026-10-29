/**
 * Stores reviewed contractor work assigned to a business-account reviewer.
 * Handoffs capture approved evidence without calculating or releasing payments.
 * Queue reads flag records whose source approval or revision is no longer current.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureTimeEntriesTable, ensureAuditEventsTable, ensureEntryRejectionArchiveTable, ensureTimesheetPeriodsTable } from "./db"
import type { AuditContext } from "./audit"
import type { TimeEntry } from "./types"
import { createDatabaseInitializer } from "./database-initializer"
const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
export const accountTriageStates=["pending","needs_information","ready_for_finance","archived"] as const
export const accountReviewStates=[...accountTriageStates,"returned_to_manager","returned_to_submitter","account_approved","reopened_for_review","payout_eligible"] as const
export type AccountReviewState=typeof accountReviewStates[number]
export type AccountHandoff={id:string;entry_id:string|null;assigned_to:string;handed_by:string;created_at:string;source_updated_at:string;current:boolean;review_state:AccountReviewState;review_note:string;review_version:number;evidence:{contractor:string;ownerEmail:string;workerCategory?:"contractor"|"employee";date:string;hours:number;project:string;description:string;reviewedBy:string;reviewedAt:string}}

/** @returns Promise<void> after idempotent handoff storage and lookup indexes exist. */
async function ensureHandoffs(){
  await ensureTimeEntriesTable()
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS account_handoffs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL,
      assigned_to text NOT NULL,handed_by text NOT NULL,source_updated_at timestamptz NOT NULL,
      evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(entry_id,source_updated_at)
    )`
    await sql`ALTER TABLE account_handoffs ALTER COLUMN entry_id DROP NOT NULL`
    await sql`ALTER TABLE account_handoffs DROP CONSTRAINT IF EXISTS account_handoffs_entry_id_fkey`
    await sql`ALTER TABLE account_handoffs ADD CONSTRAINT account_handoffs_entry_id_fkey FOREIGN KEY(entry_id) REFERENCES time_entries(id) ON DELETE SET NULL`
    await sql`CREATE INDEX IF NOT EXISTS account_handoffs_assignee_date_idx ON account_handoffs(assigned_to,created_at DESC)`
    await sql`ALTER TABLE account_handoffs ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending'
      CHECK(review_state IN ('pending','needs_information','ready_for_finance','archived')),
      ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS account_reviewed_by text,ADD COLUMN IF NOT EXISTS account_reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 0`
    await sql`ALTER TABLE account_handoffs ADD COLUMN IF NOT EXISTS review_checks jsonb NOT NULL DEFAULT '{}'::jsonb`
    await sql`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='account_handoffs'::regclass AND conname='account_handoffs_review_state_check' AND pg_get_constraintdef(oid) LIKE '%reopened_for_review%') THEN
        ALTER TABLE account_handoffs DROP CONSTRAINT IF EXISTS account_handoffs_review_state_check;
        ALTER TABLE account_handoffs ADD CONSTRAINT account_handoffs_review_state_check CHECK(review_state IN ('pending','needs_information','ready_for_finance','archived','returned_to_manager','returned_to_submitter','account_approved','reopened_for_review','payout_eligible'));
      END IF; END $$`
  })
}

/** Ensures the historical handoff snapshot survives deletion of its source entry. */
export function ensureAccountHandoffStorage():Promise<void>{return ensureHandoffs()}

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
  return await sql`SELECT h.id,h.entry_id,h.assigned_to,h.handed_by,h.evidence,h.created_at,h.source_updated_at,h.review_state,h.review_note,h.review_version,
    COALESCE(e.status='approved' AND e.updated_at=h.source_updated_at,false) AS current
    FROM account_handoffs h LEFT JOIN time_entries e ON e.id=h.entry_id
    WHERE ${admin} OR (${asSender} AND h.handed_by=${email.toLowerCase()}) OR (${!asSender} AND h.assigned_to=${email.toLowerCase()})
    ORDER BY h.created_at DESC LIMIT 100` as unknown as AccountHandoff[]
}

/** Returns entry IDs with a current, persisted final account-manager approval. */
export async function listAccountApprovedEntryIds(actor:string,admin=false):Promise<string[]>{
  await ensureHandoffs()
  const rows=await sql`SELECT e.id FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id
    WHERE (${admin} OR lower(h.account_reviewed_by)=lower(${actor})) AND h.review_state IN ('account_approved','payout_eligible')
      AND e.status='approved' AND e.updated_at=h.source_updated_at
    ORDER BY e.work_date,e.id`
  return rows.map(row=>String(row.id))
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
      AND h.review_state NOT IN ('account_approved','payout_eligible','returned_to_manager','returned_to_submitter')
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

/** Approves or returns every submitted entry in one person's configured timesheet period. */
export async function decideTimesheetBatch(input:{ownerEmail:string;startDate:string;endDate:string;selection:{id:string;revision:string}[];rejectedEntryId?:string;correctionDueAt?:string},actor:string,decision:"approved"|"rejected",category:string,finalAccountDecision:boolean,note:string,context:AuditContext):Promise<TimeEntry[]>{
  if(!input.selection.length||input.selection.length>100||new Set(input.selection.map(row=>row.id)).size!==input.selection.length||(decision==="rejected"&&!input.correctionDueAt))return []
  await ensureHandoffs();await ensureAuditEventsTable();if(decision==="rejected")await ensureEntryRejectionArchiveTable()
  const badEntryId=input.rejectedEntryId??null
  const rows=await sql`WITH requested AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.selection)}::jsonb) AS r(id uuid,revision text)
  ), batch AS MATERIALIZED (
    SELECT e.* FROM time_entries e WHERE lower(e.owner_email)=lower(${input.ownerEmail}) AND e.status='submitted'
      AND e.work_date BETWEEN ${input.startDate}::date AND ${input.endDate}::date AND e.payout_eligible_at IS NULL
  ), locked AS MATERIALIZED (
    SELECT b.*,r.revision AS expected_revision FROM batch b LEFT JOIN requested r ON r.id=b.id ORDER BY b.id FOR UPDATE OF b
  ), valid AS (
    SELECT count(*)=${input.selection.length} AND count(expected_revision)=${input.selection.length}
      AND count(*) FILTER(WHERE updated_at=expected_revision::timestamptz)=${input.selection.length} AS ok FROM locked
  ), changed AS (
    UPDATE time_entries e SET status=CASE WHEN ${decision}='approved' THEN 'approved' WHEN e.id=${badEntryId}::uuid THEN 'rejected' ELSE 'draft' END,
      reviewed_by=CASE WHEN ${decision}='approved' OR e.id=${badEntryId}::uuid THEN ${actor.toLowerCase()} ELSE NULL END,
      reviewed_at=CASE WHEN ${decision}='approved' OR e.id=${badEntryId}::uuid THEN now() ELSE NULL END,
      review_note=CASE WHEN ${decision}='rejected' AND e.id=${badEntryId}::uuid THEN ${note} ELSE NULL END,
      review_manager_email=CASE WHEN ${decision}='rejected' AND e.id<>${badEntryId}::uuid THEN NULL ELSE e.review_manager_email END,
      workflow_origin=CASE WHEN ${decision}='rejected' THEN 'returned' ELSE e.workflow_origin END,
      correction_owner_email=CASE WHEN ${decision}='rejected' THEN lower(e.owner_email) ELSE NULL END,
      correction_due_at=CASE WHEN ${decision}='rejected' THEN ${input.correctionDueAt??null}::timestamptz ELSE NULL END,
      updated_at=now()
    FROM locked l CROSS JOIN valid v WHERE v.ok AND e.id=l.id AND l.expected_revision IS NOT NULL
      AND e.updated_at=l.expected_revision::timestamptz AND e.status='submitted' RETURNING e.*
  ), forwarded AS (
    INSERT INTO account_handoffs(entry_id,assigned_to,handed_by,source_updated_at,evidence,review_state,review_note,account_reviewed_by,account_reviewed_at)
    SELECT id,CASE WHEN ${finalAccountDecision} THEN ${actor.toLowerCase()} ELSE 'business_accounts' END,${actor.toLowerCase()},updated_at,
      jsonb_build_object('contractor',contractor,'ownerEmail',owner_email,'workerCategory',${category}::text,'date',work_date,'hours',hours,'project',project,'description',description,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at),
      CASE WHEN ${finalAccountDecision} THEN 'account_approved' ELSE 'pending' END,${finalAccountDecision?note:""},CASE WHEN ${finalAccountDecision} THEN ${actor.toLowerCase()} ELSE NULL END,CASE WHEN ${finalAccountDecision} THEN now() ELSE NULL END
    FROM changed WHERE ${decision}='approved' RETURNING id,entry_id
  ), archived AS (
    INSERT INTO entry_rejection_archive(actor_email,entry_id,contractor,owner_email,project,work_date,hours,reason,rejected_at)
    SELECT ${actor.toLowerCase()},id,contractor,owner_email,project,work_date,hours,review_note,reviewed_at FROM changed
    WHERE ${decision}='rejected' AND id=${badEntryId}::uuid RETURNING entry_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},CASE WHEN ${decision}='approved' THEN 'entry_approved' WHEN id=${badEntryId}::uuid THEN 'entry_rejected' ELSE 'timesheet_returned' END,
      'time_entry',changed.id::text,jsonb_build_object('timesheetDecision',${decision}::text,'batchEntryCount',${input.selection.length},'markedRejected',changed.id=${badEntryId}::uuid,'handoffId',forwarded.id,'finalAccountDecision',${finalAccountDecision},'decisionNote',CASE WHEN ${finalAccountDecision} THEN ${note} ELSE NULL END,'correctionDueAt',${input.correctionDueAt??null}::text,'correctionOwner',CASE WHEN ${decision}='rejected' THEN changed.owner_email ELSE NULL END),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM changed LEFT JOIN forwarded ON forwarded.entry_id=changed.id
    WHERE ${decision}<>'rejected' OR changed.id<>${badEntryId}::uuid OR EXISTS(SELECT 1 FROM archived WHERE archived.entry_id=changed.id) RETURNING target_id
  )
  SELECT id,owner_email,contractor_number,review_manager_email,payout_eligible_at,workflow_origin,correction_owner_email,correction_due_at,contractor,work_date,hours,project,description,status,reviewed_by,reviewed_at,review_note,updated_at::text AS updated_at
  FROM changed WHERE EXISTS(SELECT 1 FROM audited) ORDER BY work_date,id`
  return rows.map(row=>({id:String(row.id),ownerEmail:row.owner_email?String(row.owner_email):undefined,contractorNumber:row.contractor_number?String(row.contractor_number):undefined,reviewManagerEmail:row.review_manager_email?String(row.review_manager_email):null,payoutEligible:!!row.payout_eligible_at,workflowOrigin:row.workflow_origin==="returned"?"returned":"new",correctionOwnerEmail:row.correction_owner_email?String(row.correction_owner_email):null,correctionDueAt:row.correction_due_at?new Date(String(row.correction_due_at)).toISOString():null,contractor:String(row.contractor),date:String(row.work_date).slice(0,10),hours:Number(row.hours),project:String(row.project),description:String(row.description),status:String(row.status) as TimeEntry["status"],reviewedBy:row.reviewed_by?String(row.reviewed_by):null,reviewedAt:row.reviewed_at?new Date(String(row.reviewed_at)).toISOString():null,reviewNote:row.review_note?String(row.review_note):null,revision:new Date(String(row.updated_at)).toISOString(),reviewEligible:false}))
}

/** Reopens an entire account-manager-approved batch into the approval queue, without returning it to the patron. */
export async function reopenApprovedTimesheet(input:{ownerEmail:string;periodId:string;selection:{id:string;revision:string}[];reason:string},actor:string,context:AuditContext,admin=false):Promise<TimeEntry[]>{
  if(!input.selection.length||input.selection.length>100||new Set(input.selection.map(row=>row.id)).size!==input.selection.length)return []
  await ensureTimeEntriesTable();await ensureTimesheetPeriodsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH requested AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.selection)}::jsonb) AS r(id uuid,revision text)
  ), period AS MATERIALIZED (
    SELECT id,start_date,end_date FROM timesheet_periods WHERE id=${input.periodId}::uuid
  ), batch AS MATERIALIZED (
    SELECT e.*,h.id AS handoff_id,h.evidence AS handoff_evidence FROM time_entries e JOIN account_handoffs h ON h.entry_id=e.id CROSS JOIN period p WHERE lower(e.owner_email)=lower(${input.ownerEmail})
      AND e.work_date BETWEEN p.start_date AND p.end_date AND e.status='approved' AND e.payout_eligible_at IS NULL
      AND (${admin} OR lower(e.reviewed_by)=lower(${actor}) AND lower(h.account_reviewed_by)=lower(${actor}))
      AND h.review_state='account_approved' AND h.source_updated_at=e.updated_at
  ), locked AS MATERIALIZED (
    SELECT b.*,r.revision AS expected_revision FROM batch b LEFT JOIN requested r ON r.id=b.id ORDER BY b.id FOR UPDATE OF b
  ), valid AS (
    SELECT count(*)=${input.selection.length} AND count(expected_revision)=${input.selection.length}
      AND count(*) FILTER(WHERE updated_at=expected_revision::timestamptz)=${input.selection.length} AS ok FROM locked
  ), changed AS (
    UPDATE time_entries e SET status='approved',reviewed_by=l.handoff_evidence->>'reviewedBy',reviewed_at=NULLIF(l.handoff_evidence->>'reviewedAt','')::timestamptz,review_note=NULL,updated_at=now()
    FROM locked l CROSS JOIN valid v WHERE v.ok AND e.id=l.id AND e.updated_at=l.expected_revision::timestamptz AND e.status='approved' AND e.payout_eligible_at IS NULL
    RETURNING e.*
  ), restored AS (
    UPDATE account_handoffs h SET review_state='reopened_for_review',review_note=${input.reason},account_reviewed_by=NULL,account_reviewed_at=NULL,review_version=h.review_version+1,source_updated_at=changed.updated_at
    FROM locked l JOIN changed ON changed.id=l.id WHERE h.id=l.handoff_id RETURNING h.id,h.entry_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'timesheet_reopened_for_approval','time_entry',changed.id::text,
      jsonb_build_object('reason',${input.reason},'periodId',${input.periodId},'ownerEmail',changed.owner_email,'batchEntryCount',${input.selection.length},'destination','account_manager_approval_queue'),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM changed JOIN restored ON restored.entry_id=changed.id RETURNING target_id
  ) SELECT changed.id,changed.owner_email,changed.contractor_number,changed.review_manager_email,changed.payout_eligible_at,changed.workflow_origin,changed.correction_owner_email,changed.correction_due_at,
      changed.contractor,changed.work_date::text AS work_date,changed.hours,changed.project,changed.description,changed.status,changed.reviewed_by,changed.reviewed_at,changed.review_note,changed.updated_at::text AS updated_at
    FROM changed JOIN audited ON audited.target_id=changed.id::text ORDER BY changed.work_date,changed.id`
  return rows.map(row=>({id:String(row.id),ownerEmail:row.owner_email?String(row.owner_email):undefined,contractorNumber:row.contractor_number?String(row.contractor_number):undefined,reviewManagerEmail:row.review_manager_email?String(row.review_manager_email):null,payoutEligible:!!row.payout_eligible_at,workflowOrigin:row.workflow_origin==="returned"?"returned":"new",correctionOwnerEmail:row.correction_owner_email?String(row.correction_owner_email):null,correctionDueAt:row.correction_due_at?new Date(String(row.correction_due_at)).toISOString():null,contractor:String(row.contractor),date:String(row.work_date).slice(0,10),hours:Number(row.hours),project:String(row.project),description:String(row.description??""),status:String(row.status) as TimeEntry["status"],reviewedBy:row.reviewed_by?String(row.reviewed_by):null,reviewedAt:row.reviewed_at?new Date(String(row.reviewed_at)).toISOString():null,reviewNote:row.review_note?String(row.review_note):null,revision:new Date(String(row.updated_at)).toISOString(),reviewEligible:true}))
}

/** Applies an account-manager correction only to a batch explicitly recalled from final approval. */
export async function correctReopenedTimesheetEntry(input:{id:string;periodId:string;revision:string;project:string;date:string;hours:number;description:string;reason:string},actor:string,context:AuditContext,admin=false):Promise<boolean>{
  await ensureHandoffs();await ensureTimesheetPeriodsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH period AS MATERIALIZED (SELECT id,start_date,end_date FROM timesheet_periods WHERE id=${input.periodId}::uuid),
    locked AS MATERIALIZED (
      SELECT h.id AS handoff_id,h.evidence,e.id,e.updated_at
      FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id CROSS JOIN period p
      WHERE h.id=${input.id}::uuid AND (${admin} OR h.assigned_to=lower(${actor}))
        AND h.review_state='reopened_for_review' AND h.source_updated_at=e.updated_at AND e.status='approved'
        AND e.work_date BETWEEN p.start_date AND p.end_date
      FOR UPDATE OF h,e
    ), changed AS (
      UPDATE time_entries e SET project=${input.project},work_date=${input.date}::date,hours=${input.hours},description=${input.description},updated_at=now()
      FROM locked l CROSS JOIN period p WHERE e.id=l.id AND e.updated_at=${input.revision}::timestamptz
        AND ${input.date}::date BETWEEN p.start_date AND p.end_date
        AND ${input.project}<>'' AND ${input.hours}>0 AND ${input.hours}<=24 AND ${input.description}<>''
      RETURNING e.id,e.project,e.work_date,e.hours,e.description,e.updated_at
    ), updated_handoff AS (
      UPDATE account_handoffs h SET evidence=jsonb_set(jsonb_set(jsonb_set(jsonb_set(l.evidence,'{project}',to_jsonb(changed.project)),'{date}',to_jsonb(changed.work_date::text)),'{hours}',to_jsonb(changed.hours)),'{description}',to_jsonb(changed.description)),
        source_updated_at=changed.updated_at,review_version=h.review_version+1
      FROM locked l JOIN changed ON changed.id=l.id WHERE h.id=l.handoff_id RETURNING h.id,h.entry_id
    ), audited AS (
      INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
      SELECT lower(${actor}),'recalled_timesheet_entry_corrected','account_handoff',u.id::text,
        jsonb_build_object('entryId',changed.id,'reason',${input.reason},'date',changed.work_date,'project',changed.project,'hours',changed.hours),
        ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
      FROM updated_handoff u JOIN changed ON changed.id=u.entry_id RETURNING target_id
    ) SELECT count(*)::int AS count FROM audited`
  return Number(rows[0]?.count??0)===1
}

export type AccountBatchAction = "return_manager" | "return_submitter" | "approve_timesheets" | "authorize_eligibility"
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
export async function actOnHandoffs(selection:{id:string;version:number;reject?:boolean}[],actor:string,action:AccountBatchAction,note:string,checks:AccountChecks,manager:string|null,context:AuditContext,correctionDueAt?:string):Promise<number>{
  if(!selection.length||selection.length>100||new Set(selection.map(row=>row.id)).size!==selection.length)return 0
  if(action==="return_submitter"&&selection.some(row=>typeof row.reject!=="boolean"))return 0
  if(action!=="return_submitter"&&selection.some(row=>row.reject))return 0
  await ensureHandoffs();await ensureAuditEventsTable();if(action==="return_submitter")await ensureEntryRejectionArchiveTable()
  const ready=checks.accuracy&&checks.compliance&&checks.housekeeping
  const state=action==="return_manager"?"returned_to_manager":action==="return_submitter"?"returned_to_submitter":action==="approve_timesheets"?"account_approved":"payout_eligible"
  const rows=await sql`WITH requested AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(selection)}::jsonb) AS x(id uuid,version integer,reject boolean)
  ), locked AS MATERIALIZED (
    SELECT h.id,h.entry_id,h.review_version,h.review_state,h.source_updated_at,h.evidence,e.owner_email,e.status,e.updated_at,e.payout_eligible_at,e.project,e.work_date,e.hours,e.contractor,r.version,r.reject
    FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id JOIN requested r ON r.id=h.id
    ORDER BY h.id FOR UPDATE OF h,e
  ), eligible AS (
    SELECT * FROM locked WHERE review_version=version AND status='approved' AND updated_at=source_updated_at
      AND payout_eligible_at IS NULL AND review_state IN ('pending','needs_information','ready_for_finance','reopened_for_review')
      AND (${action}<>'authorize_eligibility' OR (${ready} AND lower(owner_email)<>${actor.toLowerCase()}))
      AND (${action}<>'return_manager' OR (${manager}::text IS NOT NULL AND lower(owner_email)<>lower(${manager}::text)))
  ), changed_entries AS (
    UPDATE time_entries e SET status=CASE WHEN ${action}='return_manager' THEN 'submitted' WHEN ${action}='return_submitter' AND x.reject THEN 'rejected' WHEN ${action}='return_submitter' THEN 'draft' ELSE e.status END,
      review_note=CASE WHEN ${action}='return_submitter' AND NOT x.reject THEN NULL WHEN ${action} IN ('return_manager','return_submitter') THEN ${note} WHEN ${action}='approve_timesheets' THEN e.review_note ELSE e.review_note END,
      reviewed_by=CASE WHEN ${action}='approve_timesheets' THEN ${actor.toLowerCase()} WHEN ${action}='return_submitter' AND x.reject THEN ${actor.toLowerCase()} WHEN ${action} IN ('return_manager','return_submitter') THEN NULL ELSE e.reviewed_by END,
      reviewed_at=CASE WHEN ${action} IN ('approve_timesheets') OR (${action}='return_submitter' AND x.reject) THEN now() WHEN ${action} IN ('return_manager','return_submitter') THEN NULL ELSE e.reviewed_at END,
      review_manager_email=CASE WHEN ${action}='return_manager' THEN lower(${manager}::text) ELSE e.review_manager_email END,
      workflow_origin=CASE WHEN ${action} IN ('return_manager','return_submitter') THEN 'returned' ELSE e.workflow_origin END,
      correction_owner_email=CASE WHEN ${action}='return_manager' THEN lower(${manager}::text) WHEN ${action}='return_submitter' THEN lower(e.owner_email) ELSE e.correction_owner_email END,
      correction_due_at=CASE WHEN ${action} IN ('return_manager','return_submitter') THEN ${correctionDueAt??null}::timestamptz ELSE e.correction_due_at END,
      payout_eligible_at=CASE WHEN ${action}='authorize_eligibility' THEN now() ELSE e.payout_eligible_at END,
      payout_eligible_by=CASE WHEN ${action}='authorize_eligibility' THEN ${actor.toLowerCase()} ELSE e.payout_eligible_by END,
      updated_at=CASE WHEN ${action}<>'authorize_eligibility' THEN now() ELSE e.updated_at END
    FROM eligible x WHERE e.id=x.entry_id AND (SELECT count(*) FROM eligible)=${selection.length} RETURNING e.id,e.contractor,e.owner_email,e.project,e.work_date,e.hours,e.updated_at
  ), archived AS (
    INSERT INTO entry_rejection_archive(actor_email,entry_id,contractor,owner_email,project,work_date,hours,reason,rejected_at)
    SELECT ${actor.toLowerCase()},e.id,e.contractor,e.owner_email,e.project,e.work_date,e.hours,${note},now()
    FROM changed_entries e JOIN eligible x ON x.entry_id=e.id
    WHERE ${action}='return_submitter' AND x.reject
    RETURNING entry_id
  ), changed_handoffs AS (
    UPDATE account_handoffs h SET review_state=${state},review_note=${note},review_checks=${JSON.stringify(checks)}::jsonb,source_updated_at=e.updated_at,
      account_reviewed_by=${actor.toLowerCase()},account_reviewed_at=now(),review_version=h.review_version+1
    FROM eligible x JOIN changed_entries e ON e.id=x.entry_id WHERE h.id=x.id RETURNING h.id
  ) INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},CASE WHEN ${action}='authorize_eligibility' THEN 'account_eligibility_authorized' WHEN ${action}='approve_timesheets' AND x.review_state='reopened_for_review' THEN 'timesheet_account_override_approved' WHEN ${action}='approve_timesheets' THEN 'timesheet_account_approved' WHEN ${action}='return_submitter' AND x.reject THEN 'entry_rejected' WHEN ${action}='return_submitter' THEN 'timesheet_returned' ELSE 'account_timesheets_returned' END,'account_handoff',h.id::text,
      jsonb_build_object('state',${state}::text,'note',${note}::text,'checks',${JSON.stringify(checks)}::jsonb,'manager',${manager}::text,'eligibilityOnly',${action}='authorize_eligibility','markedRejected',coalesce(x.reject,false),'recalled',x.review_state='reopened_for_review'),${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM changed_handoffs h JOIN eligible x ON x.id=h.id
    WHERE ${action}<>'return_submitter' OR NOT x.reject OR EXISTS(SELECT 1 FROM archived a WHERE a.entry_id=x.entry_id)
    RETURNING target_id`
  return rows.length
}
