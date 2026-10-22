/**
 * Provides Neon database accessors for persistent time entry storage.
 *
 * This module owns the SQL used by the app and keeps role-aware row scoping close
 * to the data operations. API routes pass in the signed-in email plus an elevated
 * visibility flag, and these helpers enforce that scope in every query.
 */
import "server-only"
import { LastAdministratorError } from "@/lib/admin-policy"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import type {AuditContext} from "@/lib/audit"
import { ensureTeamsTranscriptInbox } from "@/lib/teams-transcript-inbox"

import { neon } from "@neondatabase/serverless"
import type { PermissionOverrides } from "@/lib/permissions"
import type {
  AccessStatus,
  EntryStatus,
  ParsedEntry,
  TimeEntry,
  UserRole,
} from "@/lib/types"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.")
}

const sql = neon(databaseUrl)

type TimeEntryRow = {
  contractor_number?: string | null
  id: string
  updated_at?: string | Date
  owner_email?: string
  review_manager_email?: string | null
  payout_eligible_at?: string | Date | null
  workflow_origin?: "new" | "returned" | null
  correction_owner_email?: string | null
  correction_due_at?: string | Date | null
  contractor: string
  work_date: string | Date
  hours: string | number
  project: string
  description: string | null
  status: EntryStatus | null
  reviewed_by: string | null
  reviewed_at: string | Date | null
  review_note: string | null
  submitted_at?: string | Date | null
}

export type UserProfile = {
  displayName: string
  imageDataUrl: string | null
}

type UserProfileRow = {
  owner_email?: string
  display_name: string | null
  image_data_url: string | null
}

export type KnownUserSummary = {
  /** Email that owns profile or time entry activity. */
  email: string
  /** Persisted profile display name, when one has been saved. */
  displayName: string
  /** Persisted profile image data URL, when one has been saved. */
  imageDataUrl: string | null
  /** Number of time entries owned by the user. */
  totalEntries: number
  /** Number of owned entries still in draft. */
  draftEntries: number
  /** Number of owned entries submitted for review. */
  submittedEntries: number
  /** Number of owned entries approved by a manager or admin. */
  approvedEntries: number
  /** Number of owned entries rejected by a manager or admin. */
  rejectedEntries: number
  /** ISO timestamp for the user's most recently created entry. */
  lastEntryAt: string | null
}

export type ManagedAccessUser = {
  /** Explicit administrator overrides for individual controls. */
  permissions?: PermissionOverrides
  /** Normalized email controlled by the admin access table. */
  email: string
  /** Role assigned by an administrator. */
  role: UserRole
  /** Whether the user is active, denied, or blocked. */
  accessStatus: AccessStatus
  /** Optional administrator note explaining the access decision. */
  note: string
  /** Email of the administrator who last changed the row. */
  updatedBy: string | null
  /** ISO timestamp for when the row was created. */
  createdAt: string
  /** ISO timestamp for the latest access update. */
  updatedAt: string
}

type KnownUserSummaryRow = {
  owner_email: string
  display_name: string | null
  image_data_url: string | null
  total_entries: string | number
  draft_entries: string | number
  submitted_entries: string | number
  approved_entries: string | number
  rejected_entries: string | number
  last_entry_at: string | Date | null
}

type ManagedAccessUserRow = {
  permissions: PermissionOverrides | null
  email: string
  role: UserRole
  access_status: AccessStatus
  note: string | null
  updated_by: string | null
  created_at: string | Date
  updated_at: string | Date
}

export type AuditAction =
  | "message_history_recovered"
  | "entry_review_requested"
  | "account_timesheets_returned"
  | "account_eligibility_authorized"
  | "account_lifecycle_updated"
  | "temporary_assignment_created"
  | "temporary_assignment_revoked"
  | "temporary_assignment_extended"
  | "account_handoff_created"
  | "account_handoff_reviewed"
  | "account_handoff_ai_reviewed"
  | "message_sent"
  | "message_edited"
  | "message_deleted"
  | "message_deleted_for_me"
  | "message_unsent_for_everyone"
  | "message_read_receipts_updated"
  | "message_alignment_updated"
  | "message_encryption_initialized"
  | "entry_created"
  | "project_created"
  | "project_updated"
  | "entries_cleared"
  | "entry_updated"
  | "entry_submitted"
  | "entry_recalled"
  | "entry_approved"
  | "entry_rejected"
  | "timesheet_returned"
  | "submission_deadline_updated"
  | "timesheet_period_created"
  | "entry_deleted"
  | "profile_updated"
  | "user_access_created"
  | "user_access_updated"
  | "authentication_succeeded"
  | "authentication_failed"
  | "authentication_signed_out"
  | "api_rate_limit_exceeded"
  | "terms_of_use_accepted"
  | "client_error_reported"
  | "user_issue_submitted"
  | "issue_updated"
  | "admin_extension_override"
  | "teams_transcript_draft_saved"
  | "teams_transcript_draft_dismissed"
  | "teams_transcript_extraction_retried"
  | "teams_transcript_development_queue_processed"
  | "teams_transcript_source_updated"
  | "teams_transcript_backfill_requested"

export type AuditEvent = {
  id: string
  actorEmail: string
  action: AuditAction
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  userAgent: string | null
  requestMethod: string | null
  requestPath: string | null
  requestId: string | null
  occurredAt: string
}

export type TimesheetPeriod = { id:string; name:string; startDate:string; endDate:string; submissionDeadline:string; managerSubmissionDeadline?:string; accountApprovalDeadline?:string; exceptionResolutionDeadline?:string; timezone?:string; managerGraceDays:number; reminderDays:number; createdBy:string; createdAt:string }
export type TimesheetPeriodAuditRecord={actorEmail:string;action:"timesheet_period_created"|"timesheet_period_updated";occurredAt:string;reason:string|null}
export type TimesheetPeriodScheduleIssue = {id:string;issueKey:string;message:string;periodIds:string[];firstSeenAt:string;lastSeenAt:string}
export type TimeProject = { id:string; name:string; description:string; active:boolean; createdBy:string; managerEmail?:string|null; createdAt:string; updatedAt:string; used?:boolean }
export type EntryRejectionRecord={id:string;actorEmail:string;entryId:string|null;contractor:string;ownerEmail:string|null;project:string;workDate:string|null;hours:number|null;reason:string;rejectedAt:string}

type AuditEventRow = {
  id: string
  actor_email: string
  action: AuditAction
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  request_method: string | null
  request_path: string | null
  request_id: string | null
  occurred_at: string | Date
}

const schemaReady = createDatabaseInitializer()
const profileSchemaReady = createDatabaseInitializer()
const auditSchemaReady = createDatabaseInitializer()
const accessSchemaReady = createDatabaseInitializer()
const workflowSettingsSchemaReady = createDatabaseInitializer()
const timesheetPeriodsSchemaReady = createDatabaseInitializer()
const projectsSchemaReady = createDatabaseInitializer()
const entryRejectionArchiveSchemaReady = createDatabaseInitializer()
const submissionExtensionsSchemaReady = createDatabaseInitializer()
const patronActivityAcknowledgementSchemaReady = createDatabaseInitializer()

/**
 * Maps a database row into the client-facing time entry shape.
 *
 * Neon can return dates and numeric values in database-native forms depending on
 * the runtime. This mapper normalizes those values into the plain JSON-friendly
 * structure expected by React components and route responses.
 *
 * @param row - Raw time entry row returned by Neon.
 * @returns Normalized time entry used by client components and API responses.
 */
function toTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    reviewManagerEmail: row.review_manager_email ?? null,
    payoutEligible: !!row.payout_eligible_at,
    workflowOrigin: row.workflow_origin ?? "new",
    correctionOwnerEmail: row.correction_owner_email ?? null,
    correctionDueAt: row.correction_due_at instanceof Date ? row.correction_due_at.toISOString() : row.correction_due_at ? new Date(String(row.correction_due_at)).toISOString() : null,
    contractor: row.contractor,
    contractorNumber: row.contractor_number??undefined,
    date:
      row.work_date instanceof Date
        ? row.work_date.toISOString().slice(0, 10)
        : String(row.work_date).slice(0, 10),
    hours: Number(row.hours),
    project: row.project,
    description: row.description ?? "",
    status: row.status ?? "draft",
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at ?? null,
    reviewedBy: row.reviewed_by,
    reviewedAt:
      row.reviewed_at instanceof Date
        ? row.reviewed_at.toISOString()
        : row.reviewed_at,
    reviewNote: row.review_note,
    revision: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

/**
 * Maps an audit event row into the client-facing audit event shape.
 *
 * Database timestamps and nullable JSON payloads are normalized so administrator
 * screens and API responses can render the audit trail without database-specific
 * value handling.
 *
 * @param row - Raw audit event row returned by Neon.
 * @returns Normalized audit event used by admin APIs and UI.
 */
function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    requestMethod: row.request_method,
    requestPath: row.request_path,
    requestId: row.request_id,
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : row.occurred_at,
  }
}

/**
 * Maps a managed access row into the app-facing access assignment shape.
 *
 * Date values are normalized to ISO strings so admin APIs can display and audit
 * assignment changes without database-specific timestamp handling.
 *
 * @param row - Raw managed access row returned by Neon.
 * @returns Normalized managed access assignment.
 */
function toManagedAccessUser(row: ManagedAccessUserRow): ManagedAccessUser {
  return {
    permissions: row.permissions ?? {},
    email: row.email,
    role: (row.role as string) === "user" ? "contractor" : row.role,
    accessStatus: row.access_status,
    note: row.note ?? "",
    updatedBy: row.updated_by,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  }
}

/**
 * Creates the time entry schema once per server process before queries run.
 *
 * The schema bootstrap is idempotent and memoized so multiple requests do not try
 * to create the same table or index repeatedly. It also adds owner_email for older
 * databases that may have been created before per-user scoping existed.
 *
 * @returns A promise that resolves after the time entries table and indexes exist.
 */
export function ensureTimeEntriesTable() {
  return schemaReady(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS time_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor text NOT NULL,
        work_date date NOT NULL,
        hours numeric(8, 2) NOT NULL CHECK (hours >= 0),
        project text NOT NULL DEFAULT 'General',
        description text NOT NULL DEFAULT '',
        owner_email text,
        status text NOT NULL DEFAULT 'draft',
        reviewed_by text,
        reviewed_at timestamptz,
        review_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT time_entries_status_check
          CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'))
      )
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS owner_email text,
      ADD COLUMN IF NOT EXISTS contractor_number text,
      ADD COLUMN IF NOT EXISTS review_manager_email text,
      ADD COLUMN IF NOT EXISTS payout_eligible_at timestamptz,
      ADD COLUMN IF NOT EXISTS payout_eligible_by text
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS reviewed_by text
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS review_note text
    `
    await sql`ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS workflow_origin text NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS correction_owner_email text,
      ADD COLUMN IF NOT EXISTS correction_due_at timestamptz,
      ADD COLUMN IF NOT EXISTS source_transcript_draft_id uuid,
      ADD COLUMN IF NOT EXISTS source_transcript_entry_index integer`
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'time_entries_status_check'
        ) THEN
          ALTER TABLE time_entries
          ADD CONSTRAINT time_entries_status_check
          CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));
        END IF;
      END
      $$
    `
    await sql`
      CREATE INDEX IF NOT EXISTS time_entries_owner_email_created_at_idx
      ON time_entries (owner_email, created_at DESC)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS time_entries_owner_work_date_created_idx
      ON time_entries (lower(owner_email), work_date DESC, created_at DESC)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS time_entries_status_work_date_idx
      ON time_entries (status, work_date DESC)
    `
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS time_entries_transcript_source_entry_idx
      ON time_entries (source_transcript_draft_id, source_transcript_entry_index)
      WHERE source_transcript_draft_id IS NOT NULL AND source_transcript_entry_index IS NOT NULL`
  })
}

/**
 * Creates the user profile schema once per server process before profile queries.
 *
 * User profiles are separate from time entries because they store display
 * preferences and image data keyed by email. The table is created lazily so local
 * and preview environments bootstrap themselves on first use.
 *
 * @returns A promise that resolves after the user profiles table exists.
 */
export function ensureUserProfilesTable() {
  return profileSchemaReady(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS user_profiles (
        owner_email text PRIMARY KEY,
        display_name text NOT NULL DEFAULT '',
        image_data_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `
  })
}

/**
 * Creates the append-only audit event schema before security events are written.
 *
 * Audit events live in their own table so product records can be changed or
 * deleted while the security timeline remains available for review. Indexes keep
 * recent admin queries responsive as the event stream grows.
 *
 * @returns A promise that resolves after the audit events table and indexes exist.
 */
export function ensureAuditEventsTable() {
  return auditSchemaReady(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_email text NOT NULL,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ip_address text,
        user_agent text,
        request_method text,
        request_path text,
        request_id text,
        occurred_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_method text`
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_path text`
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text`
    await sql`
      CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx
      ON audit_events (occurred_at DESC)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS audit_events_actor_email_occurred_at_idx
      ON audit_events (actor_email, occurred_at DESC)
    `
    await sql`
      CREATE INDEX IF NOT EXISTS audit_events_target_idx
      ON audit_events (target_type, target_id)
    `
  })
}

/** Stores per-patron acknowledgments for their own account activity items. */
export function ensurePatronActivityAcknowledgementsTable() {
  return patronActivityAcknowledgementSchemaReady(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS patron_activity_acknowledgements (
        event_id uuid NOT NULL REFERENCES audit_events(id) ON DELETE CASCADE,
        patron_email text NOT NULL,
        acknowledged_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, patron_email)
      )
    `
  })
}

/** Creates a dedicated, durable store for human rejection decisions and reasons. */
export function ensureEntryRejectionArchiveTable(){
  return entryRejectionArchiveSchemaReady(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS entry_rejection_archive (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_email text NOT NULL,
      entry_id uuid NOT NULL,
      contractor text NOT NULL,
      owner_email text,
      project text NOT NULL,
      work_date date NOT NULL,
      hours numeric(8,2) NOT NULL,
      reason text NOT NULL,
      rejected_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS entry_rejection_archive_actor_time_idx ON entry_rejection_archive (lower(actor_email),rejected_at DESC)`
  })
}

/** Creates the singleton organization workflow settings table on first use. */
export function ensureWorkflowSettingsTable() {
  return workflowSettingsSchemaReady(async () => {
    await sql`CREATE TABLE IF NOT EXISTS organization_workflow_settings (
      id text PRIMARY KEY CHECK (id = 'organization'),
      timesheet_submission_deadline timestamptz,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
  })
}

/** Creates the organization timesheet-period schedule. */
export function ensureTimesheetPeriodsTable() {
  return timesheetPeriodsSchemaReady(async () => {
    await sql`CREATE TABLE IF NOT EXISTS timesheet_periods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
      start_date date NOT NULL,
      end_date date NOT NULL,
      submission_deadline timestamptz NOT NULL,
      manager_grace_days integer NOT NULL DEFAULT 0 CHECK(manager_grace_days BETWEEN 0 AND 30),
      reminder_days integer NOT NULL DEFAULT 3 CHECK(reminder_days BETWEEN 1 AND 30),
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(start_date <= end_date)
    )`
    await sql`ALTER TABLE timesheet_periods ADD COLUMN IF NOT EXISTS manager_submission_deadline timestamptz`
    await sql`ALTER TABLE timesheet_periods ADD COLUMN IF NOT EXISTS account_approval_deadline timestamptz`
    await sql`ALTER TABLE timesheet_periods ADD COLUMN IF NOT EXISTS exception_resolution_deadline timestamptz`
    await sql`ALTER TABLE timesheet_periods ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York'`
    await sql`UPDATE timesheet_periods SET manager_submission_deadline=submission_deadline+interval '2 days',account_approval_deadline=submission_deadline+interval '3 days',exception_resolution_deadline=date_trunc('day',submission_deadline+interval '4 days')+interval '12 hours' WHERE manager_submission_deadline IS NULL OR account_approval_deadline IS NULL OR exception_resolution_deadline IS NULL`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_periods_dates_idx ON timesheet_periods(start_date,end_date)`
    await sql`CREATE TABLE IF NOT EXISTS timesheet_period_schedule_issues(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issue_key text NOT NULL UNIQUE,message text NOT NULL,
      period_ids uuid[] NOT NULL DEFAULT '{}',first_seen_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz)`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_period_schedule_issues_open_idx ON timesheet_period_schedule_issues(last_seen_at DESC) WHERE resolved_at IS NULL`
  })
}

/** Creates scoped patron deadline requests and approved submission grants. */
export function ensureSubmissionExtensionsTable(){
  return submissionExtensionsSchemaReady(async()=>{
    await ensureTimesheetPeriodsTable()
    await sql`CREATE TABLE IF NOT EXISTS timesheet_extension_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_email text NOT NULL,
      period_id uuid NOT NULL REFERENCES timesheet_periods(id) ON DELETE CASCADE,
      assigned_to text NOT NULL,
      reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
      requested_until timestamptz NOT NULL,
      not_before_until timestamptz,
      hard_cap_until timestamptz,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
      reviewed_by text,
      reviewed_at timestamptz,
      manager_note text NOT NULL DEFAULT '',
      approved_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`ALTER TABLE timesheet_extension_requests ADD COLUMN IF NOT EXISTS hard_cap_until timestamptz`
    await sql`ALTER TABLE timesheet_extension_requests ADD COLUMN IF NOT EXISTS not_before_until timestamptz`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS timesheet_extension_pending_owner_period_idx ON timesheet_extension_requests(lower(requester_email),period_id) WHERE status='pending'`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_extension_reviewer_status_idx ON timesheet_extension_requests(lower(assigned_to),status,created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_extension_owner_period_idx ON timesheet_extension_requests(lower(requester_email),period_id,status)`
  })
}

export type TimesheetExtensionRequest={id:string;requesterEmail:string;requesterName:string;periodId:string;periodName:string;assignedTo:string;reason:string;requestedUntil:string;status:"pending"|"approved"|"denied";reviewedBy:string|null;reviewedAt:string|null;managerNote:string;approvedUntil:string|null;createdAt:string}

function toTimesheetExtensionRequest(row:Record<string,unknown>):TimesheetExtensionRequest{
  return {id:String(row.id),requesterEmail:String(row.requester_email),requesterName:String(row.requester_name??row.requester_email),periodId:String(row.period_id),periodName:String(row.period_name),assignedTo:String(row.assigned_to),reason:String(row.reason),requestedUntil:new Date(String(row.requested_until)).toISOString(),status:String(row.status) as TimesheetExtensionRequest["status"],reviewedBy:row.reviewed_by?String(row.reviewed_by):null,reviewedAt:row.reviewed_at?new Date(String(row.reviewed_at)).toISOString():null,managerNote:String(row.manager_note??""),approvedUntil:row.approved_until?new Date(String(row.approved_until)).toISOString():null,createdAt:new Date(String(row.created_at)).toISOString()}
}

/** Lists only the signed-in patron's requests or requests routed to their reviewer. */
export async function listTimesheetExtensionRequests(email:string,reviewer=false,admin=false):Promise<TimesheetExtensionRequest[]>{
  await ensureSubmissionExtensionsTable()
  const rows=admin
    ? await sql`SELECT r.*,p.name AS period_name,r.requester_email AS requester_name FROM timesheet_extension_requests r JOIN timesheet_periods p ON p.id=r.period_id ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 500`
    : reviewer
    ? await sql`SELECT r.*,p.name AS period_name,r.requester_email AS requester_name FROM timesheet_extension_requests r JOIN timesheet_periods p ON p.id=r.period_id WHERE lower(r.assigned_to)=lower(${email}) ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100`
    : await sql`SELECT r.*,p.name AS period_name,r.requester_email AS requester_name FROM timesheet_extension_requests r JOIN timesheet_periods p ON p.id=r.period_id WHERE lower(r.requester_email)=lower(${email}) ORDER BY r.created_at DESC LIMIT 100`
  return rows.map(row=>toTimesheetExtensionRequest(row as Record<string,unknown>))
}

/** Creates a request only when the patron has draft or returned work in that period. */
export async function createTimesheetExtensionRequest(input:{ownerEmail:string;periodId:string;assignedTo:string;reason:string;requestedUntil:string;notBeforeUntil:string;hardCapUntil:string},context:AuditContext):Promise<TimesheetExtensionRequest|null>{
  await ensureSubmissionExtensionsTable();await ensureTimeEntriesTable();await ensureAuditEventsTable()
  const rows=await sql`WITH created AS (
    INSERT INTO timesheet_extension_requests(requester_email,period_id,assigned_to,reason,requested_until,not_before_until,hard_cap_until)
    SELECT lower(${input.ownerEmail}),p.id,lower(${input.assignedTo}),${input.reason}::text,${input.requestedUntil}::timestamptz,${input.notBeforeUntil}::timestamptz,${input.hardCapUntil}::timestamptz
    FROM timesheet_periods p WHERE p.id=${input.periodId}::uuid
      AND ${input.requestedUntil}::timestamptz>${input.notBeforeUntil}::timestamptz
      AND ${input.requestedUntil}::timestamptz<=${input.hardCapUntil}::timestamptz
      AND EXISTS(SELECT 1 FROM time_entries e WHERE lower(e.owner_email)=lower(${input.ownerEmail}) AND e.work_date BETWEEN p.start_date AND p.end_date AND e.status IN ('draft','rejected') AND e.payout_eligible_at IS NULL)
    ON CONFLICT DO NOTHING RETURNING *
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${input.ownerEmail}),'timesheet_extension_requested','timesheet_extension_request',id::text,jsonb_build_object('periodId',period_id,'assignedTo',assigned_to,'requestedUntil',requested_until,'notBeforeUntil',not_before_until,'hardCapUntil',hard_cap_until),${context.ipAddress}::text,${context.userAgent}::text,${context.requestMethod}::text,${context.requestPath}::text,${context.requestId}::text FROM created RETURNING target_id
  ) SELECT c.*,p.name AS period_name,c.requester_email AS requester_name FROM created c JOIN timesheet_periods p ON p.id=c.period_id WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length?toTimesheetExtensionRequest(rows[0] as Record<string,unknown>):null
}

/** Makes a one-time, assigned-manager decision and records the grant atomically. */
export async function decideTimesheetExtensionRequest(id:string,reviewerEmail:string,decision:"approved"|"denied",managerNote:string,decisionUntil:string|null,override:boolean,context:AuditContext):Promise<TimesheetExtensionRequest|null>{
  await ensureSubmissionExtensionsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH changed AS (
    UPDATE timesheet_extension_requests r SET status=${decision},reviewed_by=lower(${reviewerEmail}),reviewed_at=now(),manager_note=${managerNote}::text,approved_until=CASE WHEN ${decision}='approved' THEN ${decisionUntil}::timestamptz ELSE NULL END,updated_at=now()
    FROM timesheet_periods p
    WHERE r.period_id=p.id AND r.id=${id}::uuid AND r.status='pending' AND (${override} OR lower(r.assigned_to)=lower(${reviewerEmail}))
      AND (${decision}<>'approved' OR (r.requested_until>COALESCE(r.not_before_until,p.submission_deadline) AND ${decisionUntil}::timestamptz>COALESCE(r.not_before_until,p.submission_deadline) AND ${decisionUntil}::timestamptz<=r.requested_until AND ${decisionUntil}::timestamptz<=COALESCE(r.hard_cap_until,p.manager_submission_deadline)))
    RETURNING r.*
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${reviewerEmail}),CASE WHEN ${decision}='approved' THEN 'timesheet_extension_approved' ELSE 'timesheet_extension_denied' END,'timesheet_extension_request',id::text,jsonb_build_object('periodId',period_id,'requesterEmail',requester_email,'approvedUntil',approved_until,'assignedTo',assigned_to,'override',${override},'reason',manager_note),${context.ipAddress}::text,${context.userAgent}::text,${context.requestMethod}::text,${context.requestPath}::text,${context.requestId}::text FROM changed RETURNING target_id
  ) SELECT c.*,p.name AS period_name,c.requester_email AS requester_name FROM changed c JOIN timesheet_periods p ON p.id=c.period_id WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length?toTimesheetExtensionRequest(rows[0] as Record<string,unknown>):null
}

/** Checks a patron-specific approved window for user-facing deadline feedback. */
export async function hasActiveTimesheetExtension(ownerEmail:string,workDate:string):Promise<boolean>{
  await ensureSubmissionExtensionsTable()
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM timesheet_extension_requests r JOIN timesheet_periods p ON p.id=r.period_id WHERE lower(r.requester_email)=lower(${ownerEmail}) AND r.status='approved' AND r.approved_until>now() AND ${workDate}::date BETWEEN p.start_date AND p.end_date) AS active`
  return Boolean(rows[0]?.active)
}

/** Creates a shared project catalog and imports existing project names once. */
export function ensureProjectsTable(){
  return projectsSchemaReady(async()=>{
    await ensureTimeEntriesTable()
    await sql`CREATE TABLE IF NOT EXISTS time_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      description text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`ALTER TABLE time_projects ADD COLUMN IF NOT EXISTS manager_email text`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS time_projects_name_ci_idx ON time_projects(lower(name))`
    await sql`CREATE TABLE IF NOT EXISTS time_project_assignments (
      project_id uuid NOT NULL REFERENCES time_projects(id) ON DELETE CASCADE,
      patron_email text NOT NULL,
      assigned_by text NOT NULL,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      PRIMARY KEY(project_id,patron_email)
    )`
    await sql`ALTER TABLE time_project_assignments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`
    await sql`ALTER TABLE time_project_assignments DROP CONSTRAINT IF EXISTS time_project_assignments_status_check`
    await sql`ALTER TABLE time_project_assignments ADD CONSTRAINT time_project_assignments_status_check CHECK(status IN ('active','paused'))`
    await sql`CREATE INDEX IF NOT EXISTS time_project_assignments_patron_idx ON time_project_assignments(lower(patron_email))`
    await sql`CREATE TABLE IF NOT EXISTS time_project_assignment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL,
      project_name text NOT NULL,
      patron_email text NOT NULL,
      action text NOT NULL CHECK(action IN ('assigned','reassigned','removed')),
      actor_email text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`ALTER TABLE time_project_assignment_events DROP CONSTRAINT IF EXISTS time_project_assignment_events_action_check`
    await sql`ALTER TABLE time_project_assignment_events ADD CONSTRAINT time_project_assignment_events_action_check CHECK(action IN ('assigned','reassigned','removed','paused','resumed'))`
    await sql`CREATE INDEX IF NOT EXISTS time_project_assignment_events_project_idx ON time_project_assignment_events(project_id,occurred_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS time_project_assignment_events_patron_idx ON time_project_assignment_events(lower(patron_email),occurred_at DESC)`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS time_project_assignment_events_backfill_idx ON time_project_assignment_events(project_id,lower(patron_email),action,lower(actor_email),occurred_at)`
    await sql`INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
      SELECT assignment.project_id,project.name,lower(assignment.patron_email),'assigned',lower(assignment.assigned_by),assignment.assigned_at
      FROM time_project_assignments assignment JOIN time_projects project ON project.id=assignment.project_id
      WHERE NOT EXISTS(SELECT 1 FROM time_project_assignment_events event
        WHERE event.project_id=assignment.project_id AND lower(event.patron_email)=lower(assignment.patron_email)
          AND event.action='assigned' AND lower(event.actor_email)=lower(assignment.assigned_by) AND event.occurred_at=assignment.assigned_at)
      ON CONFLICT DO NOTHING`
    await sql`INSERT INTO time_projects(name,created_by)
      SELECT DISTINCT left(trim(project),120),'system@tanovo-time.local'
      FROM time_entries WHERE length(trim(project)) BETWEEN 1 AND 120
      ON CONFLICT DO NOTHING`
    await sql`CREATE INDEX IF NOT EXISTS time_projects_active_name_idx ON time_projects(active,lower(name))`
  })
}

/** @returns Catalog projects in stable name order. */
export async function listTimeProjects(includeArchived=false,patronEmail?:string):Promise<TimeProject[]>{
  await ensureProjectsTable()
  const rows=patronEmail
    ? includeArchived
      ? await sql`SELECT p.id,p.name,p.description,p.active,p.created_by,p.manager_email,p.created_at::text AS created_at,p.updated_at::text AS updated_at,EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name)) AS used FROM time_projects p JOIN time_project_assignments a ON a.project_id=p.id WHERE a.status='active' AND lower(a.patron_email)=lower(${patronEmail}) ORDER BY p.active DESC,lower(p.name)`
      : await sql`SELECT p.id,p.name,p.description,p.active,p.created_by,p.manager_email,p.created_at::text AS created_at,p.updated_at::text AS updated_at,EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name)) AS used FROM time_projects p JOIN time_project_assignments a ON a.project_id=p.id WHERE p.active AND a.status='active' AND lower(a.patron_email)=lower(${patronEmail}) ORDER BY lower(p.name)`
    : includeArchived
      ? await sql`SELECT p.id,p.name,p.description,p.active,p.created_by,p.manager_email,p.created_at::text AS created_at,p.updated_at::text AS updated_at,EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name)) AS used FROM time_projects p ORDER BY active DESC,lower(name)`
      : await sql`SELECT p.id,p.name,p.description,p.active,p.created_by,p.manager_email,p.created_at::text AS created_at,p.updated_at::text AS updated_at,EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name)) AS used FROM time_projects p WHERE active ORDER BY lower(name)`
  return rows.map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??""),active:Boolean(row.active),createdBy:String(row.created_by),managerEmail:row.manager_email?String(row.manager_email):null,createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString(),used:Boolean(row.used)}))
}

/** @returns Projects created, assigned, or explicitly assigned to a manager. */
export async function listManagerTimeProjects(managerEmail:string,includeArchived=false):Promise<TimeProject[]>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`SELECT DISTINCT p.id,p.name,p.description,p.active,p.created_by,p.manager_email,p.created_at::text AS created_at,p.updated_at::text AS updated_at,EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name)) AS used
    FROM time_projects p LEFT JOIN time_project_assignments a ON a.project_id=p.id
    WHERE lower(p.created_by)=lower(${managerEmail}) OR lower(a.assigned_by)=lower(${managerEmail}) OR lower(a.patron_email)=lower(${managerEmail})
      OR (lower(p.manager_email)=lower(${managerEmail}) AND (EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name) AND lower(e.review_manager_email)=lower(${managerEmail}) AND e.status IN ('submitted','approved','rejected'))
        OR EXISTS(SELECT 1 FROM audit_events event WHERE event.target_type='time_project' AND event.target_id=p.id::text AND event.action='project_merged')))
    ORDER BY p.active DESC,lower(p.name)`
  return rows.filter(row=>includeArchived||Boolean(row.active)).map(row=>({id:String(row.id),name:String(row.name),description:String(row.description??""),active:Boolean(row.active),createdBy:String(row.created_by),managerEmail:row.manager_email?String(row.manager_email):null,createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString(),used:Boolean(row.used)}))
}

/** @returns Whether a manager has a management relationship with a project. */
export async function isManagerProjectManager(managerEmail:string,projectId:string):Promise<boolean>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM time_projects p LEFT JOIN time_project_assignments a ON a.project_id=p.id
    WHERE p.id=${projectId}::uuid AND (lower(p.created_by)=lower(${managerEmail}) OR lower(a.assigned_by)=lower(${managerEmail}) OR lower(a.patron_email)=lower(${managerEmail}) OR (lower(p.manager_email)=lower(${managerEmail}) AND (EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name) AND lower(e.review_manager_email)=lower(${managerEmail}) AND e.status IN ('submitted','approved','rejected')) OR EXISTS(SELECT 1 FROM audit_events event WHERE event.target_type='time_project' AND event.target_id=p.id::text AND event.action='project_merged'))))) AS allowed`
  return Boolean(rows[0]?.allowed)
}

/** @returns Assignments limited to projects in one manager's scope. */
export async function listManagerTimeProjectAssignments(managerEmail:string):Promise<{projectId:string;email:string;status:"active"|"paused"}[]>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`SELECT DISTINCT a.project_id,lower(a.patron_email) AS patron_email,a.status FROM time_project_assignments a JOIN time_projects p ON p.id=a.project_id
    WHERE lower(p.created_by)=lower(${managerEmail}) OR lower(a.assigned_by)=lower(${managerEmail}) OR lower(a.patron_email)=lower(${managerEmail})
      OR (lower(p.manager_email)=lower(${managerEmail}) AND (EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(p.name) AND lower(e.review_manager_email)=lower(${managerEmail}) AND e.status IN ('submitted','approved','rejected'))
        OR EXISTS(SELECT 1 FROM audit_events event WHERE event.target_type='time_project' AND event.target_id=p.id::text AND event.action='project_merged')))
    ORDER BY lower(a.patron_email)`
  return rows.map(row=>({projectId:String(row.project_id),email:String(row.patron_email),status:String(row.status)==="paused"?"paused":"active"}))
}

/** @returns Assignment history for projects in one manager's scope. */
export async function listManagerTimeProjectAssignmentHistory(managerEmail:string,limit=500):Promise<{id:string;projectId:string;projectName:string;email:string;action:"assigned"|"reassigned"|"removed"|"paused"|"resumed";actorEmail:string;occurredAt:string}[]>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const safeLimit=Math.min(Math.max(limit,1),1000)
  const rows=await sql`SELECT event.id,event.project_id,event.project_name,event.patron_email,event.action,event.actor_email,event.occurred_at::text AS occurred_at
    FROM time_project_assignment_events event WHERE EXISTS(SELECT 1 FROM time_projects p LEFT JOIN time_project_assignments a ON a.project_id=p.id
      WHERE p.id=event.project_id AND (lower(p.created_by)=lower(${managerEmail}) OR lower(a.assigned_by)=lower(${managerEmail}) OR lower(a.patron_email)=lower(${managerEmail}) OR (lower(p.manager_email)=lower(${managerEmail}) AND (EXISTS(SELECT 1 FROM time_entries entry WHERE lower(trim(entry.project))=lower(p.name) AND lower(entry.review_manager_email)=lower(${managerEmail}) AND entry.status IN ('submitted','approved','rejected')) OR EXISTS(SELECT 1 FROM audit_events merged WHERE merged.target_type='time_project' AND merged.target_id=p.id::text AND merged.action='project_merged'))))
    ORDER BY event.occurred_at DESC,event.id DESC LIMIT ${safeLimit}`
  return rows.map(row=>({id:String(row.id),projectId:String(row.project_id),projectName:String(row.project_name),email:String(row.patron_email),action:String(row.action) as "assigned"|"reassigned"|"removed"|"paused"|"resumed",actorEmail:String(row.actor_email),occurredAt:new Date(String(row.occurred_at)).toISOString()}))
}

/** Assigns or unassigns a project for one active patron. */
export async function setTimeProjectAssignment(projectId:string,patronEmail:string,assigned:boolean,actor:string,context:AuditContext):Promise<boolean>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=assigned?await sql`WITH changed AS (
    INSERT INTO time_project_assignments(project_id,patron_email,assigned_by)
    SELECT p.id,lower(${patronEmail}),lower(${actor}) FROM time_projects p WHERE p.id=${projectId}::uuid AND p.active
    ON CONFLICT(project_id,patron_email) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now()
      WHERE time_project_assignments.assigned_by IS DISTINCT FROM EXCLUDED.assigned_by
    RETURNING project_id,patron_email,assigned_by,assigned_at
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
    SELECT changed.project_id,project.name,changed.patron_email,
      CASE WHEN previous.project_id IS NULL THEN 'assigned' ELSE 'reassigned' END,lower(${actor}),changed.assigned_at
    FROM changed JOIN time_projects project ON project.id=changed.project_id
    LEFT JOIN LATERAL (SELECT event.project_id FROM time_project_assignment_events event
      WHERE event.project_id=changed.project_id AND lower(event.patron_email)=lower(changed.patron_email) ORDER BY event.occurred_at DESC LIMIT 1) previous ON true
    RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'project_updated','time_project',changed.project_id::text,jsonb_build_object('patronEmail',changed.patron_email,'assigned',true),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM changed RETURNING target_id
  ) SELECT changed.project_id FROM changed WHERE EXISTS(SELECT 1 FROM history) AND EXISTS(SELECT 1 FROM audited)`
  :await sql`WITH removed AS (
    DELETE FROM time_project_assignments WHERE project_id=${projectId}::uuid AND lower(patron_email)=lower(${patronEmail}) RETURNING project_id,patron_email,assigned_by
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email)
    SELECT removed.project_id,project.name,removed.patron_email,'removed',lower(${actor})
    FROM removed JOIN time_projects project ON project.id=removed.project_id RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'project_updated','time_project',removed.project_id::text,jsonb_build_object('patronEmail',removed.patron_email,'assigned',false),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM removed RETURNING target_id
  ) SELECT removed.project_id FROM removed WHERE EXISTS(SELECT 1 FROM history) AND EXISTS(SELECT 1 FROM audited)`
  return rows.length>0
}

/** Pauses or resumes a worker's project access while retaining the assignment. */
export async function setTimeProjectAssignmentStatus(projectId:string,patronEmail:string,status:"active"|"paused",actor:string,context:AuditContext):Promise<boolean>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const action=status==="paused"?"paused":"resumed"
  const rows=await sql`WITH changed AS (
    UPDATE time_project_assignments SET status=${status},assigned_by=lower(${actor}),assigned_at=now()
    WHERE project_id=${projectId}::uuid AND lower(patron_email)=lower(${patronEmail}) AND status IS DISTINCT FROM ${status}
    RETURNING project_id,patron_email,status
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email)
    SELECT changed.project_id,project.name,changed.patron_email,${action},lower(${actor}) FROM changed JOIN time_projects project ON project.id=changed.project_id
    RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'project_updated','time_project',changed.project_id::text,jsonb_build_object('patronEmail',changed.patron_email,'assignmentStatus',changed.status),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM changed RETURNING target_id
  ) SELECT changed.project_id FROM changed WHERE EXISTS(SELECT 1 FROM history) AND EXISTS(SELECT 1 FROM audited)`
  return rows.length>0
}

/** @returns Active project IDs assigned to a patron for API validation. */
export async function listAssignedTimeProjectIds(patronEmail:string):Promise<string[]>{
  await ensureProjectsTable()
  const rows=await sql`SELECT p.id FROM time_projects p JOIN time_project_assignments a ON a.project_id=p.id WHERE p.active AND a.status='active' AND lower(a.patron_email)=lower(${patronEmail})`
  return rows.map(row=>String(row.id))
}

/** @returns Project IDs keyed to assigned patron emails for manager views. */
export async function listTimeProjectAssignments():Promise<{projectId:string;email:string;status:"active"|"paused"}[]>{
  await ensureProjectsTable()
  const rows=await sql`SELECT project_id,lower(patron_email) AS patron_email,status FROM time_project_assignments ORDER BY lower(patron_email)`
  return rows.map(row=>({projectId:String(row.project_id),email:String(row.patron_email),status:String(row.status)==="paused"?"paused":"active"}))
}

/** @returns Recent immutable assignment changes for manager and admin project views. */
export async function listTimeProjectAssignmentHistory(limit=500):Promise<{id:string;projectId:string;projectName:string;email:string;action:"assigned"|"reassigned"|"removed"|"paused"|"resumed";actorEmail:string;occurredAt:string}[]>{
  await ensureProjectsTable()
  const safeLimit=Math.min(Math.max(limit,1),1000)
  const rows=await sql`SELECT id,project_id,project_name,patron_email,action,actor_email,occurred_at::text AS occurred_at
    FROM time_project_assignment_events ORDER BY occurred_at DESC,id DESC LIMIT ${safeLimit}`
  return rows.map(row=>({id:String(row.id),projectId:String(row.project_id),projectName:String(row.project_name),email:String(row.patron_email),action:String(row.action) as "assigned"|"reassigned"|"removed"|"paused"|"resumed",actorEmail:String(row.actor_email),occurredAt:new Date(String(row.occurred_at)).toISOString()}))
}

/** @returns Employees and contractors assigned to a manager through an active project or reviewer assignment. */
export async function listManagerWorkforceEmails(managerEmail:string):Promise<string[]>{
  await ensureProjectsTable()
  const rows=await sql`SELECT DISTINCT lower(team.email) AS email FROM (
    SELECT owner_email AS email FROM time_entries WHERE lower(review_manager_email)=lower(${managerEmail}) AND owner_email IS NOT NULL
    UNION
    SELECT email FROM account_identities WHERE lower(created_by)=lower(${managerEmail})
    UNION
    SELECT assignment.patron_email AS email FROM time_project_assignments assignment
      JOIN time_projects project ON project.id=assignment.project_id
      WHERE (project.active AND (lower(assignment.assigned_by)=lower(${managerEmail}) OR lower(project.created_by)=lower(${managerEmail})))
        OR (project.active AND lower(project.manager_email)=lower(${managerEmail}) AND EXISTS(SELECT 1 FROM time_entries submitted
          WHERE lower(submitted.owner_email)=lower(assignment.patron_email) AND lower(trim(submitted.project))=lower(project.name)
            AND lower(submitted.review_manager_email)=lower(${managerEmail}) AND submitted.status IN ('submitted','approved','rejected')))
    UNION
    SELECT worker_assignment.patron_email AS email FROM time_project_assignments manager_assignment
      JOIN time_project_assignments worker_assignment ON worker_assignment.project_id=manager_assignment.project_id
      JOIN time_projects project ON project.id=manager_assignment.project_id
      WHERE project.active AND lower(manager_assignment.patron_email)=lower(${managerEmail})
  ) team WHERE lower(team.email)<>lower(${managerEmail}) ORDER BY lower(team.email)`
  return rows.map(row=>String(row.email).toLowerCase())
}

/** @returns True when a project name currently exists and is active. */
export async function isActiveTimeProject(name:string):Promise<boolean>{
  await ensureProjectsTable()
  const rows=await sql`SELECT 1 FROM time_projects WHERE active AND lower(name)=lower(${name.trim()}) LIMIT 1`
  return rows.length>0
}

/** Adds a unique catalog project and its audit event atomically. */
export async function createTimeProject(input:{name:string;description:string},actor:string,context:AuditContext,assignCreator=false,assignedManagerEmail?:string|null,initialAssignmentEmails:string[]=[]):Promise<TimeProject|null>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH saved AS (
    INSERT INTO time_projects(name,description,created_by,manager_email) VALUES(${input.name},${input.description},${actor.toLowerCase()},${assignedManagerEmail?.toLowerCase()??null})
    ON CONFLICT DO NOTHING RETURNING *
  ), assigned AS (
    INSERT INTO time_project_assignments(project_id,patron_email,assigned_by)
    SELECT id,lower(created_by),lower(created_by) FROM saved WHERE ${assignCreator}
    UNION
    SELECT saved.id,lower(initial.email),lower(saved.created_by) FROM saved CROSS JOIN unnest(${initialAssignmentEmails}::text[]) AS initial(email)
      WHERE length(trim(initial.email))>0
    ON CONFLICT DO NOTHING RETURNING project_id,patron_email,assigned_by,assigned_at
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
    SELECT assigned.project_id,saved.name,assigned.patron_email,'assigned',assigned.assigned_by,assigned.assigned_at
    FROM assigned JOIN saved ON saved.id=assigned.project_id
    RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT created_by,'project_created','time_project',id::text,jsonb_build_object('name',name,'description',description,'assignedToCreator',${assignCreator},'appointedManagerEmail',manager_email),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM saved RETURNING target_id
  ) SELECT id,name,description,active,created_by,manager_email,created_at::text AS created_at,updated_at::text AS updated_at FROM saved
    WHERE EXISTS(SELECT 1 FROM audited) AND (NOT ${assignCreator} OR EXISTS(SELECT 1 FROM history))`
  const row=rows[0]
  return row?{id:String(row.id),name:String(row.name),description:String(row.description??""),active:Boolean(row.active),createdBy:String(row.created_by),managerEmail:row.manager_email?String(row.manager_email):null,createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()}:null
}

/** Merges a self-created project into its manager-selected canonical project. */
export async function mergeTimeProjectInto(sourceId:string,targetId:string,actor:string,context:AuditContext):Promise<{sourceName:string;targetName:string;updatedEntries:number}|null>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH source AS (
    SELECT * FROM time_projects WHERE id=${sourceId}::uuid AND active AND manager_email IS NOT NULL
      AND lower(created_by)<>lower(manager_email) FOR UPDATE
  ), target AS (
    SELECT * FROM time_projects WHERE id=${targetId}::uuid AND active AND manager_email IS NULL AND id<>${sourceId}::uuid FOR UPDATE
  ), assigned AS (
    INSERT INTO time_project_assignments(project_id,patron_email,assigned_by)
    SELECT target.id,lower(source.created_by),lower(${actor}) FROM source CROSS JOIN target
    ON CONFLICT(project_id,patron_email) DO NOTHING
    RETURNING project_id,patron_email,assigned_at
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
    SELECT target.id,target.name,assigned.patron_email,'assigned',lower(${actor}),assigned.assigned_at
    FROM assigned JOIN target ON target.id=assigned.project_id RETURNING project_id
  ), rewritten AS (
    UPDATE time_entries entry SET project=target.name,updated_at=now()
    FROM source CROSS JOIN target
    WHERE lower(entry.owner_email)=lower(source.created_by) AND lower(trim(entry.project))=lower(source.name)
    RETURNING entry.id
  ), archived AS (
    UPDATE time_projects project SET active=false,updated_at=now()
    FROM source CROSS JOIN target WHERE project.id=source.id
    RETURNING project.id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'project_merged','time_project',source.id::text,
      jsonb_build_object('sourceName',source.name,'targetProjectId',target.id,'targetName',target.name,'creator',source.created_by,'updatedEntryCount',(SELECT count(*) FROM rewritten)),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM source CROSS JOIN target JOIN archived ON archived.id=source.id RETURNING target_id
  ) SELECT source.name AS source_name,target.name AS target_name,(SELECT count(*) FROM rewritten) AS updated_entries
    FROM source CROSS JOIN target WHERE EXISTS(SELECT 1 FROM audited)`
  const row=rows[0]
  return row?{sourceName:String(row.source_name),targetName:String(row.target_name),updatedEntries:Number(row.updated_entries)}:null
}

/** Activates or archives a catalog project and records the change atomically. */
export async function setTimeProjectActive(id:string,active:boolean,actor:string,context:AuditContext):Promise<TimeProject|null>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH before AS (SELECT * FROM time_projects WHERE id=${id}::uuid FOR UPDATE), saved AS (
    UPDATE time_projects p SET active=${active},updated_at=now() FROM before b WHERE p.id=b.id RETURNING p.*
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},'project_updated','time_project',saved.id::text,
      jsonb_build_object('name',saved.name,'active',saved.active,'previousActive',before.active),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM saved JOIN before ON true RETURNING target_id
  ) SELECT id,name,description,active,created_by,manager_email,created_at::text AS created_at,updated_at::text AS updated_at FROM saved WHERE EXISTS(SELECT 1 FROM audited)`
  const row=rows[0]
  return row?{id:String(row.id),name:String(row.name),description:String(row.description??""),active:Boolean(row.active),createdBy:String(row.created_by),managerEmail:row.manager_email?String(row.manager_email):null,createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()}:null
}

/** Deletes only a never-used project with no assignment history. */
export async function deleteUnusedTimeProject(id:string,actor:string,context:AuditContext):Promise<boolean>{
  await ensureProjectsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH candidate AS (
    SELECT p.* FROM time_projects p WHERE p.id=${id}::uuid
      AND NOT EXISTS(SELECT 1 FROM time_entries e WHERE lower(trim(e.project))=lower(trim(p.name)))
      AND NOT EXISTS(SELECT 1 FROM time_project_assignment_events event WHERE event.project_id=p.id)
    FOR UPDATE
  ), deleted AS (
    DELETE FROM time_projects p USING candidate c WHERE p.id=c.id RETURNING c.id,c.name
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'project_deleted','time_project',deleted.id::text,jsonb_build_object('name',deleted.name,'unused',true),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM deleted RETURNING target_id
  ) SELECT deleted.id FROM deleted WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length>0
}

/** @returns Scheduled periods ordered by work start date, capped for a compact admin view. */
export async function listTimesheetPeriods():Promise<TimesheetPeriod[]> {
  await ensureTimesheetPeriodsTable()
  const rows=await sql`SELECT id,name,start_date::text AS start_date,end_date::text AS end_date,
    submission_deadline::text AS submission_deadline,manager_submission_deadline::text AS manager_submission_deadline,
    account_approval_deadline::text AS account_approval_deadline,exception_resolution_deadline::text AS exception_resolution_deadline,timezone,
    manager_grace_days,reminder_days,created_by,created_at::text AS created_at
    FROM timesheet_periods ORDER BY start_date DESC LIMIT 100`
  return rows.map(row=>({id:String(row.id),name:String(row.name),startDate:String(row.start_date),endDate:String(row.end_date),submissionDeadline:new Date(String(row.submission_deadline)).toISOString(),managerSubmissionDeadline:row.manager_submission_deadline?new Date(String(row.manager_submission_deadline)).toISOString():undefined,accountApprovalDeadline:row.account_approval_deadline?new Date(String(row.account_approval_deadline)).toISOString():undefined,exceptionResolutionDeadline:row.exception_resolution_deadline?new Date(String(row.exception_resolution_deadline)).toISOString():undefined,timezone:String(row.timezone??"America/New_York"),managerGraceDays:Number(row.manager_grace_days),reminderDays:Number(row.reminder_days),createdBy:String(row.created_by),createdAt:new Date(String(row.created_at)).toISOString()}))
}

/** Lists unresolved schedule conflicts for period settings and reminder operators. */
export async function listTimesheetPeriodScheduleIssues():Promise<TimesheetPeriodScheduleIssue[]> {
  await ensureTimesheetPeriodsTable()
  const rows=await sql`SELECT id,issue_key,message,period_ids::text AS period_ids,first_seen_at::text AS first_seen_at,last_seen_at::text AS last_seen_at
    FROM timesheet_period_schedule_issues WHERE resolved_at IS NULL ORDER BY last_seen_at DESC`
  return rows.map(row=>({id:String(row.id),issueKey:String(row.issue_key),message:String(row.message),periodIds:Array.isArray(row.period_ids)?row.period_ids.map(String):String(row.period_ids??"").replace(/[{}]/g,"").split(",").filter(Boolean),firstSeenAt:new Date(String(row.first_seen_at)).toISOString(),lastSeenAt:new Date(String(row.last_seen_at)).toISOString()}))
}

/** Returns the period's creation and change history for authorized period managers. */
export async function listTimesheetPeriodAuditHistory(periodId:string):Promise<TimesheetPeriodAuditRecord[]>{
  await ensureTimesheetPeriodsTable();await ensureAuditEventsTable()
  const rows=await sql`SELECT actor_email,action,occurred_at::text AS occurred_at,metadata->>'reason' AS reason
    FROM audit_events WHERE target_type='timesheet_period' AND target_id=${periodId}
      AND action IN ('timesheet_period_created','timesheet_period_updated')
    ORDER BY occurred_at DESC LIMIT 100`
  return rows.map(row=>({actorEmail:String(row.actor_email),action:String(row.action) as TimesheetPeriodAuditRecord["action"],occurredAt:new Date(String(row.occurred_at)).toISOString(),reason:row.reason?String(row.reason):null}))
}

async function recordTimesheetPeriodScheduleIssue(issueKey:string,message:string,periodIds:string[]=[]):Promise<void>{
  await ensureTimesheetPeriodsTable()
  await sql`INSERT INTO timesheet_period_schedule_issues(issue_key,message,period_ids)
    VALUES(${issueKey},${message},${periodIds}::uuid[]) ON CONFLICT(issue_key) DO UPDATE SET message=EXCLUDED.message,period_ids=EXCLUDED.period_ids,last_seen_at=now(),resolved_at=NULL`
}

async function resolveTimesheetPeriodScheduleIssue(issueKey:string):Promise<void>{
  await ensureTimesheetPeriodsTable()
  await sql`UPDATE timesheet_period_schedule_issues SET resolved_at=now() WHERE issue_key=${issueKey} AND resolved_at IS NULL`
}

/** Checks period ranges and deadlines, retaining a visible issue until each conflict is corrected. */
export async function reconcileTimesheetPeriodSchedule(context:AuditContext):Promise<void>{
  const periods=await listTimesheetPeriods()
  const activeKeys=new Set<string>()
  const ordered=[...periods].sort((a,b)=>a.startDate.localeCompare(b.startDate))
  for(let index=1;index<ordered.length;index++){
    const previous=ordered[index-1],current=ordered[index]
    if(current.startDate<=previous.endDate){
      const ids=[previous.id,current.id].sort(),key=`overlap:${ids.join(":")}`
      activeKeys.add(key)
      await recordTimesheetPeriodScheduleIssue(key,`${previous.name} (${previous.startDate}–${previous.endDate}) overlaps ${current.name} (${current.startDate}–${current.endDate}). Work-date periods cannot overlap.`,ids)
    }
  }
  for(const period of periods){
    const key=`deadline-order:${period.id}`
    const worker=Date.parse(period.submissionDeadline),manager=Date.parse(period.managerSubmissionDeadline??""),account=Date.parse(period.accountApprovalDeadline??""),exception=Date.parse(period.exceptionResolutionDeadline??"")
    const valid=Number.isFinite(worker)&&Number.isFinite(manager)&&Number.isFinite(account)&&Number.isFinite(exception)&&worker>=Date.parse(`${period.endDate}T00:00:00Z`)&&worker<manager&&manager<account&&account<=exception
    if(!valid){
      activeKeys.add(key)
      await recordTimesheetPeriodScheduleIssue(key,`${period.name} has an invalid deadline schedule. Worker submission must follow the work-period end, followed by manager submission, account approval, and exception resolution.`,[period.id])
    }
  }
  const open=await sql`SELECT issue_key FROM timesheet_period_schedule_issues WHERE resolved_at IS NULL`
  for(const row of open)if(!activeKeys.has(String(row.issue_key))&&!String(row.issue_key).startsWith("auto-generation:"))await resolveTimesheetPeriodScheduleIssue(String(row.issue_key))
  await ensureDefaultUpcomingTimesheetPeriod(context)
}

/** Checks archive status using the database calendar, so server timezone cannot change edit rights. */
export async function isTimesheetPeriodArchived(periodId:string):Promise<boolean> {
  await ensureTimesheetPeriodsTable()
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM timesheet_periods WHERE id=${periodId}::uuid AND end_date < CURRENT_DATE) AS archived`
  return Boolean(rows[0]?.archived)
}

/** Checks whether a work date belongs to a period that has fully elapsed. */
export async function isTimesheetDateArchived(workDate:string):Promise<boolean> {
  await ensureTimesheetPeriodsTable()
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM timesheet_periods WHERE ${workDate}::date BETWEEN start_date AND end_date AND end_date < CURRENT_DATE) AS archived`
  return Boolean(rows[0]?.archived)
}

/** Creates a non-overlapping period and immutable audit row in one statement. */
export async function createTimesheetPeriod(input:{name:string;startDate:string;endDate:string;submissionDeadline:string;managerSubmissionDeadline?:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string;timezone?:string;managerGraceDays:number;reminderDays:number},actor:string,context:AuditContext):Promise<TimesheetPeriod|null>{
  await ensureTimesheetPeriodsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH lock AS (SELECT pg_advisory_xact_lock(hashtext('tanovo-timesheet-periods'))), saved AS (
    INSERT INTO timesheet_periods(name,start_date,end_date,submission_deadline,manager_submission_deadline,account_approval_deadline,exception_resolution_deadline,timezone,manager_grace_days,reminder_days,created_by)
    SELECT ${input.name},${input.startDate}::date,${input.endDate}::date,${input.submissionDeadline}::timestamptz,
      COALESCE(${input.managerSubmissionDeadline??null}::timestamptz,${input.submissionDeadline}::timestamptz+interval '2 days'),
      COALESCE(${input.accountApprovalDeadline??null}::timestamptz,${input.submissionDeadline}::timestamptz+interval '3 days'),
      COALESCE(${input.exceptionResolutionDeadline??null}::timestamptz,date_trunc('day',${input.submissionDeadline}::timestamptz+interval '4 days')+interval '12 hours'),
      ${input.timezone??"America/New_York"},${input.managerGraceDays},${input.reminderDays},${actor.toLowerCase()}
    FROM lock WHERE ${input.endDate}::date >= CURRENT_DATE AND NOT EXISTS(SELECT 1 FROM timesheet_periods WHERE start_date <= ${input.endDate}::date AND end_date >= ${input.startDate}::date)
    RETURNING *
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT created_by,'timesheet_period_created','timesheet_period',id::text,
      jsonb_build_object('name',name,'startDate',start_date,'endDate',end_date,'submissionDeadline',submission_deadline,'managerSubmissionDeadline',manager_submission_deadline,'accountApprovalDeadline',account_approval_deadline,'exceptionResolutionDeadline',exception_resolution_deadline,'timezone',timezone,'managerGraceDays',manager_grace_days,'reminderDays',reminder_days),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM saved RETURNING target_id
  ) SELECT id,name,start_date::text AS start_date,end_date::text AS end_date,submission_deadline::text AS submission_deadline,
      manager_submission_deadline::text AS manager_submission_deadline,account_approval_deadline::text AS account_approval_deadline,exception_resolution_deadline::text AS exception_resolution_deadline,timezone,
      manager_grace_days,reminder_days,created_by,created_at::text AS created_at FROM saved WHERE EXISTS(SELECT 1 FROM audited)`
  const row=rows[0]
  return row?{id:String(row.id),name:String(row.name),startDate:String(row.start_date),endDate:String(row.end_date),submissionDeadline:new Date(String(row.submission_deadline)).toISOString(),managerSubmissionDeadline:new Date(String(row.manager_submission_deadline)).toISOString(),accountApprovalDeadline:new Date(String(row.account_approval_deadline)).toISOString(),exceptionResolutionDeadline:new Date(String(row.exception_resolution_deadline)).toISOString(),timezone:String(row.timezone),managerGraceDays:Number(row.manager_grace_days),reminderDays:Number(row.reminder_days),createdBy:String(row.created_by),createdAt:new Date(String(row.created_at)).toISOString()}:null
}

function deadlineInTimezone(date:Date,hour:number,timezone:string):string{
  const year=date.getUTCFullYear(),month=date.getUTCMonth()+1,day=date.getUTCDate()
  const nominal=Date.UTC(year,month-1,day,hour,0,0)
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(nominal))
  const get=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find(part=>part.type===type)?.value)
  const wall=Date.UTC(get("year"),get("month")-1,get("day"),get("hour"),get("minute"))
  return new Date(nominal+(nominal-wall)).toISOString()
}

/** Creates a successor matching the latest period's duration unless the next period was configured. */
export async function ensureDefaultUpcomingTimesheetPeriod(context:AuditContext):Promise<TimesheetPeriod|null>{
  const periods=await listTimesheetPeriods()
  if(!periods.length)return null
  const latest=[...periods].sort((a,b)=>b.endDate.localeCompare(a.endDate))[0]
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:latest.timezone||"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  if(latest.endDate>=today)return null
  if(periods.some(period=>period.startDate>latest.endDate)){
    await resolveTimesheetPeriodScheduleIssue("auto-generation:collision")
    return null
  }
  const periodLengthDays=Math.max(1,Math.round((Date.parse(`${latest.endDate}T00:00:00.000Z`)-Date.parse(`${latest.startDate}T00:00:00.000Z`))/86_400_000)+1)
  const date=new Date(`${latest.endDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate()+1)
  const candidate=date
  const startDate=candidate.toISOString().slice(0,10)
  const end=new Date(candidate);end.setUTCDate(end.getUTCDate()+periodLengthDays-1)
  const endDate=end.toISOString().slice(0,10)
  const endWeekday=end.getUTCDay()
  const daysUntilNextMonday=(8-endWeekday)%7||7
  const workerDue=new Date(end);workerDue.setUTCDate(workerDue.getUTCDate()+daysUntilNextMonday)
  const managerDue=new Date(workerDue);managerDue.setUTCDate(managerDue.getUTCDate()+2)
  const accountsDue=new Date(workerDue);accountsDue.setUTCDate(accountsDue.getUTCDate()+3)
  const issuesDue=new Date(workerDue);issuesDue.setUTCDate(issuesDue.getUTCDate()+4)
  const name=`${startDate} - ${endDate}`
  const created=await createTimesheetPeriod({name,startDate,endDate,submissionDeadline:deadlineInTimezone(workerDue,17,latest.timezone||"America/New_York"),managerSubmissionDeadline:deadlineInTimezone(managerDue,17,latest.timezone||"America/New_York"),accountApprovalDeadline:deadlineInTimezone(accountsDue,17,latest.timezone||"America/New_York"),exceptionResolutionDeadline:deadlineInTimezone(issuesDue,12,latest.timezone||"America/New_York"),timezone:latest.timezone||"America/New_York",managerGraceDays:latest.managerGraceDays,reminderDays:latest.reminderDays},"system@tanovo-time.local",context)
  if(created){await resolveTimesheetPeriodScheduleIssue("auto-generation:collision");return created}
  const concurrent=await listTimesheetPeriods()
  if(concurrent.some(period=>period.startDate===startDate&&period.endDate===endDate))return null
  await recordTimesheetPeriodScheduleIssue("auto-generation:collision",`Automatic period ${name} (${startDate}–${endDate}) could not be created because its dates conflict with a configured window. Resolve the conflicting dates in Timesheet periods; automatic generation will retry.`,concurrent.filter(period=>period.startDate<=endDate&&period.endDate>=startDate).map(period=>period.id))
  return null
}

/** Updates a submission window and audits the before/after values atomically. */
export async function updateTimesheetPeriod(id:string,input:{name:string;startDate:string;endDate:string;submissionDeadline:string;managerSubmissionDeadline?:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string;timezone?:string;managerGraceDays:number;reminderDays:number},actor:string,reason:string,context:AuditContext):Promise<TimesheetPeriod|null>{
  await ensureTimesheetPeriodsTable();await ensureAuditEventsTable()
  const rows=await sql`WITH lock AS (SELECT pg_advisory_xact_lock(hashtext('tanovo-timesheet-periods'))), before AS (
    SELECT p.* FROM timesheet_periods p CROSS JOIN lock WHERE p.id=${id}::uuid FOR UPDATE
  ), saved AS (
    UPDATE timesheet_periods p SET name=${input.name},start_date=${input.startDate}::date,end_date=${input.endDate}::date,
      submission_deadline=${input.submissionDeadline}::timestamptz,
      manager_submission_deadline=COALESCE(${input.managerSubmissionDeadline??null}::timestamptz,${input.submissionDeadline}::timestamptz+interval '2 days'),
      account_approval_deadline=COALESCE(${input.accountApprovalDeadline??null}::timestamptz,${input.submissionDeadline}::timestamptz+interval '3 days'),
      exception_resolution_deadline=COALESCE(${input.exceptionResolutionDeadline??null}::timestamptz,date_trunc('day',${input.submissionDeadline}::timestamptz+interval '4 days')+interval '12 hours'),
      timezone=${input.timezone??"America/New_York"},manager_grace_days=${input.managerGraceDays},reminder_days=${input.reminderDays}
    FROM before b WHERE p.id=b.id AND b.end_date>=CURRENT_DATE AND ${input.endDate}::date>=CURRENT_DATE AND NOT EXISTS(SELECT 1 FROM timesheet_periods other
      WHERE other.id<>p.id AND other.start_date<=${input.endDate}::date AND other.end_date>=${input.startDate}::date)
    RETURNING p.*
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},'timesheet_period_updated','timesheet_period',saved.id::text,
      jsonb_build_object('reason',${reason}::text,'before',jsonb_build_object('name',before.name,'startDate',before.start_date,'endDate',before.end_date,'submissionDeadline',before.submission_deadline,'managerSubmissionDeadline',before.manager_submission_deadline,'accountApprovalDeadline',before.account_approval_deadline,'exceptionResolutionDeadline',before.exception_resolution_deadline,'timezone',before.timezone,'managerGraceDays',before.manager_grace_days,'reminderDays',before.reminder_days),
        'after',jsonb_build_object('name',saved.name,'startDate',saved.start_date,'endDate',saved.end_date,'submissionDeadline',saved.submission_deadline,'managerSubmissionDeadline',saved.manager_submission_deadline,'accountApprovalDeadline',saved.account_approval_deadline,'exceptionResolutionDeadline',saved.exception_resolution_deadline,'timezone',saved.timezone,'managerGraceDays',saved.manager_grace_days,'reminderDays',saved.reminder_days)),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM saved JOIN before ON before.id=saved.id RETURNING target_id
  ) SELECT saved.id,saved.name,saved.start_date::text AS start_date,saved.end_date::text AS end_date,
      saved.submission_deadline::text AS submission_deadline,saved.manager_submission_deadline::text AS manager_submission_deadline,saved.account_approval_deadline::text AS account_approval_deadline,
      saved.exception_resolution_deadline::text AS exception_resolution_deadline,saved.timezone,saved.manager_grace_days,saved.reminder_days,saved.created_by,saved.created_at::text AS created_at
    FROM saved WHERE EXISTS(SELECT 1 FROM audited)`
  const row=rows[0]
  return row?{id:String(row.id),name:String(row.name),startDate:String(row.start_date),endDate:String(row.end_date),submissionDeadline:new Date(String(row.submission_deadline)).toISOString(),managerSubmissionDeadline:new Date(String(row.manager_submission_deadline)).toISOString(),accountApprovalDeadline:new Date(String(row.account_approval_deadline)).toISOString(),exceptionResolutionDeadline:new Date(String(row.exception_resolution_deadline)).toISOString(),timezone:String(row.timezone),managerGraceDays:Number(row.manager_grace_days),reminderDays:Number(row.reminder_days),createdBy:String(row.created_by),createdAt:new Date(String(row.created_at)).toISOString()}:null
}

/** @returns Current hard submission boundary as ISO text, or null when not configured. */
export async function getTimesheetSubmissionDeadline(): Promise<string | null> {
  await ensureTimesheetPeriodsTable()
  const periods=await sql`SELECT submission_deadline::text AS deadline FROM timesheet_periods WHERE end_date >= CURRENT_DATE ORDER BY start_date LIMIT 1`
  if(periods[0]?.deadline)return new Date(String(periods[0].deadline)).toISOString()
  await ensureWorkflowSettingsTable()
  const rows = await sql`SELECT timesheet_submission_deadline::text AS deadline
    FROM organization_workflow_settings WHERE id = 'organization'`
  const deadline = rows[0]?.deadline
  return deadline ? new Date(String(deadline)).toISOString() : null
}

/** Saves an organization submission boundary and its audit event atomically. */
export async function setTimesheetSubmissionDeadline(deadline: string, actor: string, reason: string, context: AuditContext): Promise<string> {
  await ensureWorkflowSettingsTable()
  await ensureAuditEventsTable()
  const rows = await sql`WITH saved AS (
    INSERT INTO organization_workflow_settings(id, timesheet_submission_deadline, updated_by, updated_at)
    VALUES ('organization', ${deadline}::timestamptz, ${actor.toLowerCase()}, now())
    ON CONFLICT (id) DO UPDATE SET timesheet_submission_deadline = EXCLUDED.timesheet_submission_deadline,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING timesheet_submission_deadline, updated_by
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT updated_by, 'submission_deadline_updated', 'organization_workflow_settings', 'organization',
      jsonb_build_object('timesheetSubmissionDeadline', timesheet_submission_deadline, 'reason', ${reason}),
      ${context.ipAddress}, ${context.userAgent}, ${context.requestMethod}, ${context.requestPath}, ${context.requestId}
    FROM saved RETURNING id
  ) SELECT timesheet_submission_deadline::text AS deadline FROM saved WHERE EXISTS(SELECT 1 FROM audited)`
  if (!rows.length) throw new Error("Submission deadline could not be confirmed.")
  return new Date(String(rows[0].deadline)).toISOString()
}

/**
 * Creates the admin-managed access assignment schema.
 *
 * This table lets administrators add employees, assign roles, and deny or block
 * access from inside the app instead of relying only on deployment environment
 * variables. Environment admins remain a recovery path outside this table.
 *
 * @returns A promise that resolves after the access table and indexes exist.
 */
export function ensureManagedAccessTable() {
  return accessSchemaReady(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS managed_user_access (
        email text PRIMARY KEY,
        role text NOT NULL CHECK (role IN ('admin', 'manager', 'account_manager', 'employee', 'contractor', 'user')),
        access_status text NOT NULL DEFAULT 'active'
          CHECK (access_status IN ('active', 'denied', 'suspended', 'retired', 'blocked')),
        note text NOT NULL DEFAULT '',
        updated_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS managed_user_access_status_idx
      ON managed_user_access (access_status, role)
    `
    await sql`ALTER TABLE managed_user_access ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb`
    await sql`DO $$
      BEGIN
        ALTER TABLE managed_user_access DROP CONSTRAINT IF EXISTS managed_user_access_access_status_check;
        ALTER TABLE managed_user_access ADD CONSTRAINT managed_user_access_access_status_check
          CHECK (access_status IN ('active', 'denied', 'suspended', 'retired', 'blocked'));
      END
    $$`
    // Keep legacy rows readable while older deployments still use the shared database.
    await sql`DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'managed_user_access'::regclass
            AND conname = 'managed_user_access_role_check'
            AND pg_get_constraintdef(oid) LIKE '%account_manager%'
            AND pg_get_constraintdef(oid) LIKE '%contractor%'
        ) THEN
          ALTER TABLE managed_user_access DROP CONSTRAINT IF EXISTS managed_user_access_role_check;
          ALTER TABLE managed_user_access ADD CONSTRAINT managed_user_access_role_check
            CHECK (role IN ('admin', 'manager', 'account_manager', 'employee', 'contractor', 'user'));
        END IF;
      END
    $$`
  })
}

/**
 * Loads a user's persisted display profile.
 *
 * Missing rows are treated as an empty profile so first-time users can open the
 * profile editor without requiring a separate create step.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @returns The saved profile or an empty default profile.
 */
export async function getUserProfile(ownerEmail: string): Promise<UserProfile> {
  await ensureUserProfilesTable()

  const rows = await sql`
    SELECT display_name, image_data_url
    FROM user_profiles
    WHERE lower(owner_email) = lower(${ownerEmail})
  `
  const row = (rows as UserProfileRow[])[0]

  return {
    displayName: row?.display_name ?? "",
    imageDataUrl: row?.image_data_url ?? null,
  }
}

/**
 * Creates or updates the signed-in user's persisted profile.
 *
 * The owner email is the primary key, so each account has exactly one profile.
 * Updating replaces the display name and image payload while preserving the same
 * owner identity.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param profile - Profile values to persist.
 * @returns The saved profile returned from the database.
 */
export async function upsertUserProfile(
  ownerEmail: string,
  profile: UserProfile,
) {
  await ensureUserProfilesTable()

  const rows = await sql`
    INSERT INTO user_profiles (
      owner_email,
      display_name,
      image_data_url
    )
    VALUES (
      ${ownerEmail},
      ${profile.displayName},
      ${profile.imageDataUrl}
    )
    ON CONFLICT (owner_email)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      image_data_url = EXCLUDED.image_data_url,
      updated_at = now()
    RETURNING display_name, image_data_url
  `
  const row = (rows as UserProfileRow[])[0]

  return {
    displayName: row?.display_name ?? "",
    imageDataUrl: row?.image_data_url ?? null,
  }
}

/**
 * Appends a security audit event to the immutable application timeline.
 *
 * Callers provide actor, action, target, and sanitized metadata. This helper only
 * inserts new audit rows, preserving an append-only history for integrity review.
 *
 * @param event - Audit event details to persist.
 * @param event.actorEmail - Email of the signed-in user performing the action.
 * @param event.action - Security-relevant action that occurred.
 * @param event.targetType - Entity type affected by the action.
 * @param event.targetId - Optional id of the affected entity.
 * @param event.metadata - Sanitized contextual data for later review.
 * @param event.ipAddress - Optional request IP address.
 * @param event.userAgent - Optional request user agent.
 * @param event.requestMethod - Optional HTTP method that produced the event.
 * @param event.requestPath - Optional path without query parameters.
 * @param event.requestId - Optional hosting or proxy request identifier.
 * @returns The created audit event.
 */
export async function recordAuditEvent(event: {
  actorEmail: string
  action: AuditAction
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
  requestMethod?: string | null
  requestPath?: string | null
  requestId?: string | null
}) {
  await ensureAuditEventsTable()

  const rows = await sql`
    INSERT INTO audit_events (
      actor_email,
      action,
      target_type,
      target_id,
      metadata,
      ip_address,
      user_agent,
      request_method,
      request_path,
      request_id
    )
    VALUES (
      ${event.actorEmail},
      ${event.action},
      ${event.targetType},
      ${event.targetId ?? null},
      ${JSON.stringify(event.metadata ?? {})}::jsonb,
      ${event.ipAddress ?? null},
      ${event.userAgent ?? null},
      ${event.requestMethod ?? null},
      ${event.requestPath ?? null},
      ${event.requestId ?? null}
    )
    RETURNING
      id,
      actor_email,
      action,
      target_type,
      target_id,
      metadata,
      ip_address,
      user_agent,
      request_method,
      request_path,
      request_id,
      occurred_at
  `

  return toAuditEvent((rows as AuditEventRow[])[0])
}

/**
 * Lists recent audit events for administrator security review.
 *
 * The limit is clamped to protect availability and keep API responses bounded.
 * Events are returned newest-first so admins see recent sensitive activity first.
 *
 * @param limit - Maximum number of audit events to return.
 * @returns Recent audit events in reverse chronological order.
 */
export async function listAuditEvents(limit = 100) {
  await ensureAuditEventsTable()

  const safeLimit = Math.min(Math.max(limit, 1), 250)
  const rows = await sql`
    SELECT
      id,
      actor_email,
      action,
      target_type,
      target_id,
      metadata,
      ip_address,
      user_agent,
      request_method,
      request_path,
      request_id,
      occurred_at
    FROM audit_events
    ORDER BY occurred_at DESC
    LIMIT ${safeLimit}
  `

  return (rows as AuditEventRow[]).map(toAuditEvent)
}

/** Finds the safe audit context tied to a support-case correlation reference. */
export async function listAuditEventsByCorrelation(reference:string,limit=50){
  await ensureAuditEventsTable()
  const safeLimit=Math.min(Math.max(limit,1),100)
  const rows=await sql`SELECT id,actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id,occurred_at
    FROM audit_events WHERE target_id=${reference} OR metadata->>'reference'=${reference}
    ORDER BY occurred_at DESC,id DESC LIMIT ${safeLimit}`
  return (rows as AuditEventRow[]).map(toAuditEvent)
}

/** Loads one keyset-paginated audit page so administrators can traverse full history. */
export async function listAuditEventPage(options:{limit?:number;beforeAt?:string;beforeId?:string;from?:string;through?:string;search?:string;actor?:string;action?:string;targetType?:string;scope?:string}={}){
  await ensureAuditEventsTable()
  const safeLimit=Math.min(Math.max(options.limit??250,1),250)
  const rows=await sql`
    SELECT id,actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id,occurred_at
    FROM audit_events
    WHERE (${options.beforeAt??null}::timestamptz IS NULL OR (occurred_at,id)<(${options.beforeAt??null}::timestamptz,${options.beforeId??null}::uuid))
      AND (${options.from??null}::date IS NULL OR occurred_at>=${options.from??null}::date)
      AND (${options.through??null}::date IS NULL OR occurred_at<(${options.through??null}::date+interval '1 day'))
      AND (${options.actor??null}::text IS NULL OR lower(actor_email)=lower(${options.actor??null}))
      AND (${options.action??null}::text IS NULL OR action=${options.action??null})
      AND (${options.targetType??null}::text IS NULL OR target_type=${options.targetType??null})
      AND (${options.scope??null}::text IS NULL OR
        (${options.scope??null}='access' AND target_type IN ('managed_user_access','account_identity') AND action IN ('user_access_created','user_access_updated')) OR
        (${options.scope??null}='periods' AND target_type='timesheet_period' AND action IN ('timesheet_period_created','timesheet_period_updated')) OR
        (${options.scope??null}='projects' AND target_type='time_project' AND action IN ('project_created','project_updated')))
      AND (${options.search??null}::text IS NULL OR concat_ws(' ',actor_email,action,target_type,target_id,request_method,request_path,request_id,metadata::text) ILIKE ${options.search?`%${options.search}%`:null})
    ORDER BY occurred_at DESC,id DESC
    LIMIT ${safeLimit+1}
  ` as AuditEventRow[]
  const hasMore=rows.length>safeLimit
  const pageRows=rows.slice(0,safeLimit)
  const events=pageRows.map(toAuditEvent)
  const last=events.at(-1)
  return {events,nextCursor:hasMore&&last?{occurredAt:last.occurredAt,id:last.id}:null}
}

/** Returns a bounded, privacy-filtered audit timeline for one authenticated patron. */
export async function listPatronAccountActivity(email: string, limit = 100) {
  await ensureAuditEventsTable()
  await ensureTimeEntriesTable()
  await ensurePatronActivityAcknowledgementsTable()
  const safeLimit = Math.min(Math.max(limit, 1), 100)
  const rows = await sql`
    SELECT event.id,event.action,event.target_type,event.target_id,event.occurred_at::text AS occurred_at,
      (event.action IN ('entry_rejected','timesheet_returned')) AS requires_attention,
      (ack.event_id IS NOT NULL) AS acknowledged
    FROM audit_events event
    LEFT JOIN patron_activity_acknowledgements ack
      ON ack.event_id=event.id AND lower(ack.patron_email)=lower(${email})
    WHERE lower(event.actor_email) <> lower(${email})
      AND (
        (event.target_type IN ('managed_user_access','account_lifecycle') AND lower(event.target_id)=lower(${email}))
        OR (event.target_type='temporary_assignment' AND lower(event.metadata->>'email')=lower(${email}))
        OR (event.target_type='time_entry' AND EXISTS (
          SELECT 1 FROM time_entries entry
          WHERE entry.id::text=event.target_id AND lower(entry.owner_email)=lower(${email})
        ))
      )
    ORDER BY event.occurred_at DESC
    LIMIT ${safeLimit}
  `
  return (rows as Array<{id:string;action:string;target_type:string;target_id:string|null;occurred_at:string;requires_attention:boolean;acknowledged:boolean}>).map(row=>({
    id:row.id,
    action:row.action,
    targetType:row.target_type,
    targetId:row.target_id,
    occurredAt:row.occurred_at,
    requiresAttention:row.requires_attention,
    acknowledged:row.acknowledged,
  }))
}

/** Acknowledges an activity item only if it is visible in this patron's feed. */
export async function acknowledgePatronAccountActivity(email: string, eventId: string) {
  await ensureAuditEventsTable()
  await ensureTimeEntriesTable()
  await ensurePatronActivityAcknowledgementsTable()
  const rows = await sql`
    INSERT INTO patron_activity_acknowledgements(event_id,patron_email)
    SELECT event.id,lower(${email})
    FROM audit_events event
    WHERE event.id=${eventId}::uuid
      AND lower(event.actor_email)<>lower(${email})
      AND (
        (event.target_type IN ('managed_user_access','account_lifecycle') AND lower(event.target_id)=lower(${email}))
        OR (event.target_type='temporary_assignment' AND lower(event.metadata->>'email')=lower(${email}))
        OR (event.target_type='time_entry' AND EXISTS (
          SELECT 1 FROM time_entries entry
          WHERE entry.id::text=event.target_id AND lower(entry.owner_email)=lower(${email})
        ))
      )
    ON CONFLICT(event_id,patron_email) DO NOTHING
    RETURNING event_id
  `
  if ((rows as Array<{event_id:string}>).length) return true
  const existing = await sql`
    SELECT 1 FROM patron_activity_acknowledgements ack
    JOIN audit_events event ON event.id=ack.event_id
    WHERE ack.event_id=${eventId}::uuid AND lower(ack.patron_email)=lower(${email})
      AND lower(event.actor_email)<>lower(${email})
      AND (
        (event.target_type IN ('managed_user_access','account_lifecycle') AND lower(event.target_id)=lower(${email}))
        OR (event.target_type='temporary_assignment' AND lower(event.metadata->>'email')=lower(${email}))
        OR (event.target_type='time_entry' AND EXISTS (
          SELECT 1 FROM time_entries entry
          WHERE entry.id::text=event.target_id AND lower(entry.owner_email)=lower(${email})
        ))
      )
    LIMIT 1
  `
  return existing.length > 0
}

/**
 * Loads one admin-managed access assignment by email.
 *
 * Access resolution uses this helper to determine whether an administrator has
 * granted, denied, or blocked an account from inside the app.
 *
 * @param email - Email whose access assignment should be loaded.
 * @returns The managed access assignment, or null when no row exists.
 */
export async function getManagedAccessUser(email: string) {
  await ensureManagedAccessTable()

  const rows = await sql`
    SELECT email, role, access_status, note, permissions, updated_by, created_at, updated_at
    FROM managed_user_access
    WHERE email = ${email.toLowerCase()}
  `

  const row = (rows as ManagedAccessUserRow[])[0]
  return row ? toManagedAccessUser(row) : null
}

/**
 * Lists every admin-managed access assignment.
 *
 * The admin user directory combines these rows with observed profile and entry
 * activity so admins can manage access and review app usage together.
 *
 * @returns Managed access assignments sorted by email.
 */
export async function listManagedAccessUsers() {
  await ensureManagedAccessTable()

  const rows = await sql`
    SELECT email, role, access_status, note, permissions, updated_by, created_at, updated_at
    FROM managed_user_access
    ORDER BY email ASC
  `

  return (rows as ManagedAccessUserRow[]).map(toManagedAccessUser)
}

/**
 * Creates or updates an admin-managed access assignment.
 *
 * The email is normalized before persistence, making future sign-in checks
 * deterministic. Updates preserve the original creation timestamp while tracking
 * the administrator who last changed the assignment.
 *
 * @param assignment - Assignment values to save.
 * @param assignment.email - Email to add or update.
 * @param assignment.role - Role to assign.
 * @param assignment.accessStatus - Access state to apply.
 * @param assignment.note - Optional admin note for the decision.
 * @param assignment.updatedBy - Email of the administrator making the change.
 * @param assignment.environmentAdmins - Recovery admins supplied by server configuration.
 * @returns The saved managed access assignment.
 */
export async function upsertManagedAccessUser(assignment: {
  environmentAdmins?: string[]
  permissions?: PermissionOverrides
  email: string
  role: UserRole
  accessStatus: AccessStatus
  note?: string
  updatedBy: string
}) {
  await ensureManagedAccessTable()

  const results = await sql.transaction([sql`
    INSERT INTO managed_user_access (
      email,
      role,
      access_status,
      note,
      permissions,
      updated_by
    )
    SELECT
      ${assignment.email.toLowerCase()},
      ${assignment.role},
      ${assignment.accessStatus},
      ${assignment.note ?? ""},
      ${JSON.stringify(assignment.permissions ?? {})}::jsonb,
      ${assignment.updatedBy}
    WHERE ((${assignment.role} = 'admin' AND ${assignment.accessStatus} = 'active')
      OR ${(assignment.environmentAdmins?.length ?? 0) > 0}
      OR EXISTS (
        SELECT 1 FROM managed_user_access
        WHERE role = 'admin' AND access_status = 'active'
          AND email <> ${assignment.email.toLowerCase()}
      ))
      AND (${assignment.environmentAdmins?.includes(assignment.updatedBy.toLowerCase()) ?? false}
        OR EXISTS (
          SELECT 1 FROM managed_user_access WHERE email = ${assignment.updatedBy.toLowerCase()}
            AND role = 'admin' AND access_status = 'active'
        ))
    ON CONFLICT (email)
    DO UPDATE SET
      role = EXCLUDED.role,
      access_status = EXCLUDED.access_status,
      note = EXCLUDED.note,
      permissions = EXCLUDED.permissions,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING email, role, access_status, note, permissions, updated_by, created_at, updated_at
  `], { isolationLevel: "Serializable" })

  const rows = results[0]
  if (!rows.length) throw new LastAdministratorError()

  return toManagedAccessUser((rows as ManagedAccessUserRow[])[0])
}

/** Saves an admin access change and its audit record atomically. */
export async function upsertManagedAccessUserWithAudit(assignment: {
  environmentAdmins?: string[]
  permissions?: PermissionOverrides
  email: string
  role: UserRole
  accessStatus: AccessStatus
  note?: string
  updatedBy: string
  context: AuditContext
}) {
  await ensureManagedAccessTable()
  await ensureAuditEventsTable()
  const email=assignment.email.toLowerCase()
  const actor=assignment.updatedBy.toLowerCase()
  const results=await sql.transaction([sql`WITH previous AS MATERIALIZED (
      SELECT role,access_status,permissions,note FROM managed_user_access WHERE email=${email} FOR UPDATE
    ), saved AS (
      INSERT INTO managed_user_access(email,role,access_status,note,permissions,updated_by)
      SELECT ${email},${assignment.role},${assignment.accessStatus},${assignment.note??""},${JSON.stringify(assignment.permissions??{})}::jsonb,${actor}
      WHERE ((${assignment.role}='admin' AND ${assignment.accessStatus}='active')
        OR ${(assignment.environmentAdmins?.length??0)>0}
        OR EXISTS(SELECT 1 FROM managed_user_access WHERE role='admin' AND access_status='active' AND email<>${email}))
        AND (${assignment.environmentAdmins?.includes(actor)??false}
          OR EXISTS(SELECT 1 FROM managed_user_access WHERE email=${actor} AND role='admin' AND access_status='active'))
      ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,access_status=EXCLUDED.access_status,note=EXCLUDED.note,
        permissions=EXCLUDED.permissions,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING email,role,access_status,note,permissions,updated_by,created_at,updated_at
    ), audited AS (
      INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
      SELECT ${actor},CASE WHEN previous.role IS NULL THEN 'user_access_created' ELSE 'user_access_updated' END,
        'managed_user_access',saved.email,jsonb_build_object('fromRole',previous.role,'toRole',saved.role,
        'fromStatus',previous.access_status,'toStatus',saved.access_status,'noteChanged',previous.note IS DISTINCT FROM saved.note,
        'permissionsChanged',previous.permissions IS DISTINCT FROM saved.permissions,
        'beforePermissions',previous.permissions,'afterPermissions',saved.permissions),
        ${assignment.context.ipAddress},${assignment.context.userAgent},${assignment.context.requestMethod},${assignment.context.requestPath},${assignment.context.requestId}
      FROM saved LEFT JOIN previous ON true RETURNING target_id
    ) SELECT saved.email,saved.role,saved.access_status,saved.note,saved.permissions,saved.updated_by,saved.created_at,saved.updated_at
      FROM saved WHERE EXISTS(SELECT 1 FROM audited)`],{isolationLevel:"Serializable"})
  const rows=results[0]
  if(!rows.length)throw new LastAdministratorError()
  return toManagedAccessUser((rows as ManagedAccessUserRow[])[0])
}

/**
 * Delegates rights atomically without changing an existing account's role/status.
 * Concurrent admin blocking or promotion prevents the delegation from applying.
 * @param email - Validated employee identity.
 * @param role - Employee baseline used only when creating an environment-backed row.
 * @param permissions - Explicit workflow-right changes to merge with existing rights.
 * @param updatedBy - Authenticated delegator identity for audit attribution.
 * @returns Promise<ManagedAccessUser> containing the saved assignment.
 */
export async function delegateEmployeePermissions(email:string,role:"employee"|"contractor",permissions:PermissionOverrides,updatedBy:string):Promise<ManagedAccessUser> {
  await ensureManagedAccessTable()
  const rows = await sql`INSERT INTO managed_user_access (email,role,access_status,permissions,updated_by)
    VALUES (${email.toLowerCase()},${role},'active',${JSON.stringify(permissions)}::jsonb,${updatedBy})
    ON CONFLICT (email) DO UPDATE SET permissions = managed_user_access.permissions || EXCLUDED.permissions,
      updated_by = EXCLUDED.updated_by, updated_at = NOW()
    WHERE managed_user_access.access_status = 'active' AND managed_user_access.role IN ('employee','contractor','user')
    RETURNING email,role,access_status,note,permissions,updated_by,created_at,updated_at`
  if (!rows.length) throw new Error("Employee access changed before delegation")
  return toManagedAccessUser((rows as ManagedAccessUserRow[])[0])
}

/**
 * Lists users known through profiles or time entry ownership.
 *
 * The app does not yet persist role assignments in the database, so this summary
 * focuses on operational activity: profile details, entry counts by approval
 * status, and the most recent entry timestamp for each known email.
 *
 * @returns Known users with profile and time entry activity summaries.
 */
export async function listKnownUsers(): Promise<KnownUserSummary[]> {
  await ensureUserProfilesTable()
  await ensureTimeEntriesTable()

  const rows = await sql`
    WITH entry_summary AS (
      SELECT
        owner_email,
        COUNT(*) AS total_entries,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft_entries,
        COUNT(*) FILTER (WHERE status = 'submitted') AS submitted_entries,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_entries,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_entries,
        MAX(created_at) AS last_entry_at
      FROM time_entries
      WHERE owner_email IS NOT NULL AND owner_email <> ''
      GROUP BY owner_email
    ),
    profile_summary AS (
      SELECT owner_email, display_name, image_data_url
      FROM user_profiles
      WHERE owner_email IS NOT NULL AND owner_email <> ''
    )
    SELECT
      COALESCE(profile_summary.owner_email, entry_summary.owner_email) AS owner_email,
      profile_summary.display_name,
      profile_summary.image_data_url,
      COALESCE(entry_summary.total_entries, 0) AS total_entries,
      COALESCE(entry_summary.draft_entries, 0) AS draft_entries,
      COALESCE(entry_summary.submitted_entries, 0) AS submitted_entries,
      COALESCE(entry_summary.approved_entries, 0) AS approved_entries,
      COALESCE(entry_summary.rejected_entries, 0) AS rejected_entries,
      entry_summary.last_entry_at
    FROM profile_summary
    FULL OUTER JOIN entry_summary
      ON profile_summary.owner_email = entry_summary.owner_email
    ORDER BY owner_email ASC
  `

  return (rows as KnownUserSummaryRow[]).map((row) => ({
    email: row.owner_email,
    displayName: row.display_name ?? "",
    imageDataUrl: row.image_data_url,
    totalEntries: Number(row.total_entries),
    draftEntries: Number(row.draft_entries),
    submittedEntries: Number(row.submitted_entries),
    approvedEntries: Number(row.approved_entries),
    rejectedEntries: Number(row.rejected_entries),
    lastEntryAt:
      row.last_entry_at instanceof Date
        ? row.last_entry_at.toISOString()
        : row.last_entry_at,
  }))
}

/**
 * Lists entries for the current owner or all entries for elevated roles.
 *
 * Regular users and employees only receive rows tied to their email. Managers and
 * administrators pass includeAll=true so reporting screens can show team-wide
 * data without duplicating query logic in the route layer.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param includeAll - Whether elevated roles should bypass owner scoping.
 * @returns Time entries visible to the caller.
 */
export async function listTimeEntries(ownerEmail: string, includeAll = false) {
  await ensureTimeEntriesTable()
  await ensureAuditEventsTable()

  const rows = includeAll
    ? await sql`
        SELECT entry.id, entry.owner_email, entry.contractor_number, entry.review_manager_email,
          entry.payout_eligible_at,entry.workflow_origin,entry.correction_owner_email,entry.correction_due_at,
          entry.contractor, entry.work_date, entry.hours, entry.project, entry.description,
          entry.status, entry.reviewed_by, entry.reviewed_at, entry.review_note, entry.updated_at::text AS updated_at,
          submission.occurred_at::text AS submitted_at
        FROM time_entries entry
        LEFT JOIN LATERAL (
          SELECT occurred_at FROM audit_events
          WHERE target_type='time_entry' AND target_id=entry.id::text AND action='entry_submitted'
          ORDER BY occurred_at DESC LIMIT 1
        ) submission ON true
        ORDER BY entry.work_date DESC, entry.created_at DESC
      `
    : await sql`
        SELECT entry.id, entry.owner_email, entry.contractor_number, entry.review_manager_email,
          entry.payout_eligible_at,entry.workflow_origin,entry.correction_owner_email,entry.correction_due_at,
          entry.contractor, entry.work_date, entry.hours, entry.project, entry.description,
          entry.status, entry.reviewed_by, entry.reviewed_at, entry.review_note, entry.updated_at::text AS updated_at,
          submission.occurred_at::text AS submitted_at
        FROM time_entries entry
        LEFT JOIN LATERAL (
          SELECT occurred_at FROM audit_events
          WHERE target_type='time_entry' AND target_id=entry.id::text AND action='entry_submitted'
          ORDER BY occurred_at DESC LIMIT 1
        ) submission ON true
        WHERE lower(entry.owner_email) = lower(${ownerEmail})
        ORDER BY entry.work_date DESC, entry.created_at DESC
      `

  return (rows as TimeEntryRow[]).map(toTimeEntry)
}

/**
 * Persists parsed time entries under the signed-in user's email in bounded batches.
 *
 * Creation is always scoped to the caller even when the caller is elevated. This
 * keeps ownership explicit and prevents manager/admin-created entries from being
 * accidentally attributed to another employee.
 *
 * @param ownerEmail - Email that should own the created entries.
 * @param entries - Parsed time entries to insert.
 * @param contractorNumber - Server-resolved official number, never client-issued.
 * @returns Newly created time entries with database ids, in input order.
 */
export async function createTimeEntries(
  ownerEmail: string,
  entries: ParsedEntry[],
  contractorNumber?: string,
  context?: AuditContext,
) {
  await ensureTimeEntriesTable()
  if(context)await ensureAuditEventsTable()

  if (entries.length === 0) {
    return []
  }

  const created: TimeEntry[] = []

  // Keep each HTTP transaction bounded while reducing per-row network overhead.
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50)
    const results = await sql.transaction(batch.map(entry => context ? sql`
      WITH created AS (
      INSERT INTO time_entries (
        contractor, work_date, hours, project, description, owner_email, contractor_number
      )
      VALUES (
        ${entry.contractor}, ${entry.date}, ${entry.hours}, ${entry.project || "General"},
        ${entry.description || ""}, ${ownerEmail}, ${contractorNumber ?? null}
      )
      RETURNING id, owner_email, contractor_number, review_manager_email,
        payout_eligible_at, contractor, work_date, hours, project, description,
        status, reviewed_by, reviewed_at, review_note, updated_at::text AS updated_at
      ), audited AS (
        INSERT INTO audit_events (
          actor_email, action, target_type, target_id, metadata, ip_address,
          user_agent, request_method, request_path, request_id
        )
        SELECT ${ownerEmail.toLowerCase()}, 'entry_created', 'time_entry', id::text,
          jsonb_build_object('status',status,'hours',hours,'date',work_date),
          ${context.ipAddress}, ${context.userAgent}, ${context.requestMethod},
          ${context.requestPath}, ${context.requestId}
        FROM created
        RETURNING target_id
      )
      SELECT * FROM created WHERE EXISTS(SELECT 1 FROM audited)
    ` : sql`
      INSERT INTO time_entries (
        contractor, work_date, hours, project, description, owner_email, contractor_number
      )
      VALUES (
        ${entry.contractor}, ${entry.date}, ${entry.hours}, ${entry.project || "General"},
        ${entry.description || ""}, ${ownerEmail}, ${contractorNumber ?? null}
      )
      RETURNING id, owner_email, contractor_number, review_manager_email,
        payout_eligible_at, contractor, work_date, hours, project, description,
        status, reviewed_by, reviewed_at, review_note, updated_at::text AS updated_at
    `))
    for (const rows of results) created.push(toTimeEntry((rows as TimeEntryRow[])[0]))
  }

  return created
}

/** Atomically converts a patron-owned transcript proposal into regular draft entries. */
export async function saveTeamsTranscriptDraftEntries(input: {
  draftId: string
  ownerEmail: string
  contractor: string
  contractorNumber?: string
  entries: ParsedEntry[]
  context: AuditContext
}) {
  await ensureTeamsTranscriptInbox()
  await ensureTimeEntriesTable()
  await ensureAuditEventsTable()
  const ownerEmail = input.ownerEmail.toLowerCase()
  const rows = await sql`WITH claimed AS (
      UPDATE teams_transcript_drafts SET status='saved',updated_at=now()
      WHERE id=${input.draftId}::uuid AND lower(owner_email)=${ownerEmail} AND status='needs_review' AND expires_at>now()
      RETURNING id
    ), source_entries AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.entries.map((entry,index)=>({entryIndex:index,date:entry.date,hours:entry.hours,project:entry.project,description:entry.description})))}::jsonb)
        AS item("entryIndex" integer,date date,hours numeric,project text,description text)
    ), created AS (
      INSERT INTO time_entries (
        contractor,work_date,hours,project,description,owner_email,contractor_number,
        source_transcript_draft_id,source_transcript_entry_index
      )
      SELECT ${input.contractor},item.date,item.hours,item.project,item.description,${ownerEmail},${input.contractorNumber??null},claimed.id,item."entryIndex"
      FROM claimed CROSS JOIN source_entries item
      RETURNING id,owner_email,contractor_number,review_manager_email,payout_eligible_at,workflow_origin,
        correction_owner_email,correction_due_at,contractor,work_date,hours,project,description,status,
        reviewed_by,reviewed_at,review_note,updated_at::text AS updated_at
    ), audited_entries AS (
      INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
      SELECT ${ownerEmail},'entry_created','time_entry',created.id::text,
        jsonb_build_object('status',created.status,'hours',created.hours,'date',created.work_date,'source','teams_transcript'),
        ${input.context.ipAddress},${input.context.userAgent},${input.context.requestMethod},${input.context.requestPath},${input.context.requestId}
      FROM created RETURNING target_id
    ), audited_draft AS (
      INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
      SELECT ${ownerEmail},'teams_transcript_draft_saved','teams_transcript_draft',claimed.id::text,
        jsonb_build_object('entryCount',(SELECT count(*) FROM created)),
        ${input.context.ipAddress},${input.context.userAgent},${input.context.requestMethod},${input.context.requestPath},${input.context.requestId}
      FROM claimed RETURNING target_id
    )
    SELECT created.* FROM created JOIN audited_entries ON audited_entries.target_id=created.id::text
      WHERE EXISTS(SELECT 1 FROM audited_draft)` as TimeEntryRow[]
  if (rows.length) return { status: "saved" as const, entries: rows.map(toTimeEntry) }

  const existing = await getTeamsTranscriptDraftSavedEntries(input.draftId, ownerEmail)
  if (existing.length) return { status: "already_saved" as const, entries: existing }
  return { status: "unavailable" as const, entries: [] as TimeEntry[] }
}

export async function getTeamsTranscriptDraftSavedEntries(draftId:string, ownerEmail:string) {
  await ensureTimeEntriesTable()
  const rows = await sql`SELECT id,owner_email,contractor_number,review_manager_email,payout_eligible_at,workflow_origin,
      correction_owner_email,correction_due_at,contractor,work_date,hours,project,description,status,reviewed_by,
      reviewed_at,review_note,updated_at::text AS updated_at
    FROM time_entries WHERE source_transcript_draft_id=${draftId}::uuid AND lower(owner_email)=${ownerEmail.toLowerCase()}
    ORDER BY source_transcript_entry_index ASC` as TimeEntryRow[]
  return rows.map(toTimeEntry)
}

/**
 * Loads one visible time entry for business-rule validation.
 *
 * Route handlers use this before updates or deletes so they can validate status
 * transitions and edit locks against the current database state instead of
 * trusting the client to describe the existing entry accurately.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param id - Database id of the entry to load.
 * @param includeAll - Whether elevated roles should bypass owner scoping.
 * @returns The visible entry, or null when the row is missing or hidden.
 */
export async function getTimeEntry(
  ownerEmail: string,
  id: string,
  includeAll = false,
) {
  await ensureTimeEntriesTable()

  const rows = await sql`
    SELECT
      id,
      owner_email,
      contractor_number,
      review_manager_email,
      payout_eligible_at,
      workflow_origin,
      correction_owner_email,
      correction_due_at,
      contractor,
      work_date,
      hours,
      project,
      description,
      status,
      reviewed_by,
      reviewed_at,
      review_note,
      updated_at::text AS updated_at
    FROM time_entries
    WHERE id = ${id}
      AND (${includeAll} OR lower(owner_email) = lower(${ownerEmail}))
  `

  const row = (rows as TimeEntryRow[])[0]
  return row ? toTimeEntry(row) : null
}

/**
 * Updates a single entry when the signed-in user has permission to edit it.
 *
 * The owner check happens in the SQL WHERE clause so an unauthorized update simply
 * returns no row. Elevated callers can set includeAll=true to edit entries visible
 * in team management views.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param id - Database id of the entry to update.
 * @param patch - Partial time entry fields to apply.
 * @param includeAll - Whether elevated roles should bypass owner scoping.
 * @param reviewerEmail - Authenticated independent reviewer for decisions.
 * @param expectedRevision - Optional evidence timestamp checked atomically in SQL.
 * @returns The updated entry, or null when no visible entry matches.
 */
export async function updateTimeEntry(
  ownerEmail: string,
  id: string,
  patch: Partial<ParsedEntry> & {
    status?: EntryStatus
    reviewNote?: string | null
    reviewManagerEmail?: string | null
  },
  includeAll = false,
  reviewerEmail?: string,
  expectedRevision?: string,
) {
  await ensureTimeEntriesTable()

  const rows = await sql`
    UPDATE time_entries
    SET
      contractor = COALESCE(${patch.contractor ?? null}, contractor),
      work_date = COALESCE(${patch.date ?? null}, work_date),
      hours = COALESCE(${patch.hours ?? null}, hours),
      project = COALESCE(${patch.project ?? null}, project),
      description = COALESCE(${patch.description ?? null}, description),
      status = COALESCE(${patch.status ?? null}, status),
      review_manager_email = CASE WHEN ${patch.reviewManagerEmail !== undefined} THEN ${patch.reviewManagerEmail ?? null} ELSE review_manager_email END,
      reviewed_by = CASE
        WHEN ${patch.status ?? null} IN ('approved', 'rejected')
        THEN ${reviewerEmail ?? null}
        WHEN ${patch.status ?? null} IN ('draft', 'submitted')
        THEN null
        ELSE reviewed_by
      END,
      reviewed_at = CASE
        WHEN ${patch.status ?? null} IN ('approved', 'rejected')
        THEN now()
        WHEN ${patch.status ?? null} IN ('draft', 'submitted')
        THEN null
        ELSE reviewed_at
      END,
      review_note = CASE
        WHEN ${patch.status ?? null} = 'rejected'
        THEN ${patch.reviewNote ?? ""}
        WHEN ${patch.status ?? null} IN ('draft', 'submitted', 'approved')
        THEN null
        ELSE review_note
      END,
      updated_at = now()
    WHERE id = ${id}
      AND (${includeAll} OR lower(owner_email) = lower(${ownerEmail}))
      AND (${expectedRevision??null}::timestamptz IS NULL OR updated_at=${expectedRevision??null}::timestamptz)
      AND payout_eligible_at IS NULL
      AND (${patch.status ?? null} NOT IN ('approved', 'rejected') OR ${patch.status ?? null} IS NULL
        OR (status = 'submitted' AND lower(owner_email) <> lower(${ownerEmail}) AND ${reviewerEmail ?? null}::text IS NOT NULL))
      AND (lower(owner_email) <> lower(${ownerEmail}) OR status IN ('draft','rejected')
        OR (status='submitted' AND ${patch.status ?? null}='draft'
          AND ${patch.contractor===undefined&&patch.date===undefined&&patch.hours===undefined&&patch.project===undefined&&patch.description===undefined}))
    RETURNING
      id,
      owner_email,
      contractor_number,
      review_manager_email,
      payout_eligible_at,
      contractor,
      work_date,
      hours,
      project,
      description,
      status,
      reviewed_by,
      reviewed_at,
      review_note,
      updated_at::text AS updated_at
  `

  const row = (rows as TimeEntryRow[])[0]
  return row ? toTimeEntry(row) : null
}

/** Updates editable timesheet evidence and its audit event in one database statement. */
export async function updateTimeEntryWithAudit(
  ownerEmail: string,
  id: string,
  patch: Partial<ParsedEntry> & { status?: EntryStatus; reviewNote?: string | null; reviewManagerEmail?: string | null },
  includeAll: boolean,
  reviewerEmail: string | undefined,
  expectedRevision: string,
  audit: { actorEmail: string; action: AuditAction; metadata: Record<string, unknown>; context: AuditContext },
  allowSelfApproval = false,
): Promise<TimeEntry | null> {
  await ensureTimeEntriesTable()
  await ensureAuditEventsTable()
  const rows = await sql`WITH changed AS (
    UPDATE time_entries
    SET contractor = COALESCE(${patch.contractor ?? null}, contractor),
      work_date = COALESCE(${patch.date ?? null}, work_date),
      hours = COALESCE(${patch.hours ?? null}, hours),
      project = COALESCE(${patch.project ?? null}, project),
      description = COALESCE(${patch.description ?? null}, description),
      status = COALESCE(${patch.status ?? null}, status),
      review_manager_email = CASE WHEN ${patch.reviewManagerEmail !== undefined} THEN ${patch.reviewManagerEmail ?? null} ELSE review_manager_email END,
      reviewed_by = CASE WHEN ${patch.status ?? null} IN ('approved','rejected') THEN ${reviewerEmail ?? null} WHEN ${patch.status ?? null} IN ('draft','submitted') THEN null ELSE reviewed_by END,
      reviewed_at = CASE WHEN ${patch.status ?? null} IN ('approved','rejected') THEN now() WHEN ${patch.status ?? null} IN ('draft','submitted') THEN null ELSE reviewed_at END,
      review_note = CASE WHEN ${patch.status ?? null} = 'rejected' THEN ${patch.reviewNote ?? ''} WHEN ${patch.status ?? null} IN ('draft','submitted','approved') THEN null ELSE review_note END,
      updated_at = now()
    WHERE id = ${id}::uuid
      AND (${includeAll} OR lower(owner_email) = lower(${ownerEmail}))
      AND updated_at = ${expectedRevision}::timestamptz
      AND payout_eligible_at IS NULL
      AND (${patch.status ?? null} NOT IN ('approved','rejected') OR ${patch.status ?? null} IS NULL OR (status='submitted' AND lower(owner_email)<>lower(${ownerEmail}) AND ${reviewerEmail ?? null}::text IS NOT NULL) OR (${allowSelfApproval} AND ${patch.status ?? null}='approved' AND status='submitted' AND lower(owner_email)=lower(${ownerEmail}) AND ${reviewerEmail ?? null}::text IS NOT NULL))
      AND (lower(owner_email)<>lower(${ownerEmail}) OR status IN ('draft','rejected') OR (status='submitted' AND ${patch.status ?? null}='draft' AND ${patch.contractor===undefined&&patch.date===undefined&&patch.hours===undefined&&patch.project===undefined&&patch.description===undefined}) OR (${allowSelfApproval} AND status='submitted' AND ${patch.status ?? null}='approved'))
    RETURNING *
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${audit.actorEmail.toLowerCase()},${audit.action},'time_entry',id::text,${JSON.stringify(audit.metadata)}::jsonb,
      ${audit.context.ipAddress},${audit.context.userAgent},${audit.context.requestMethod},${audit.context.requestPath},${audit.context.requestId}
    FROM changed RETURNING target_id
  )
  SELECT id,owner_email,contractor_number,review_manager_email,payout_eligible_at,workflow_origin,correction_owner_email,correction_due_at,contractor,work_date,hours,project,description,status,reviewed_by,reviewed_at,review_note,updated_at::text AS updated_at
  FROM changed WHERE EXISTS (SELECT 1 FROM audited)`
  return rows.length ? toTimeEntry(rows[0] as TimeEntryRow) : null
}

/**
 * Rejects submitted evidence and writes its audit event in the same SQL statement.
 * @param id - Authorized source timesheet identifier.
 * @param actor - Independent authenticated reviewer, never the source owner.
 * @param revision - Exact evidence revision loaded or explicitly confirmed by the UI.
 * @param note - Required validated human rejection reason.
 * @param context - Request audit metadata, never message plaintext or credentials.
 * @returns Promise<TimeEntry|null> after both changes succeed, or null for stale evidence.
 */
export async function rejectSubmittedEntry(id:string,actor:string,revision:string,note:string,context:AuditContext):Promise<TimeEntry|null>{
  await ensureTimeEntriesTable();await ensureAuditEventsTable();await ensureEntryRejectionArchiveTable()
  const rows=await sql`WITH changed AS (
    UPDATE time_entries SET status='rejected',review_note=${note},reviewed_by=${actor.toLowerCase()},reviewed_at=now(),updated_at=now()
    WHERE id=${id}::uuid AND status='submitted' AND updated_at=${revision}::timestamptz
      AND lower(owner_email)<>${actor.toLowerCase()} AND payout_eligible_at IS NULL RETURNING *
  ), archived AS (
    INSERT INTO entry_rejection_archive(actor_email,entry_id,contractor,owner_email,project,work_date,hours,reason,rejected_at)
    SELECT ${actor.toLowerCase()},id,contractor,owner_email,project,work_date,hours,review_note,reviewed_at FROM changed
    RETURNING entry_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT ${actor.toLowerCase()},'entry_rejected','time_entry',id::text,jsonb_build_object('fromStatus','submitted','toStatus','rejected'),${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId}
    FROM changed WHERE EXISTS(SELECT 1 FROM archived WHERE archived.entry_id=changed.id) RETURNING target_id
  ) SELECT id,owner_email,contractor_number,review_manager_email,payout_eligible_at,workflow_origin,correction_owner_email,correction_due_at,contractor,work_date,hours,project,description,status,reviewed_by,reviewed_at,review_note,updated_at::text AS updated_at
    FROM changed WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length?toTimeEntry(rows[0] as TimeEntryRow):null
}

/** Returns durable rejection snapshots for one manager, or all managers for admin review. */
export async function listEntryRejections(actorEmail:string|null,limit=250):Promise<EntryRejectionRecord[]>{
  await ensureEntryRejectionArchiveTable()
  const safeLimit=Math.min(Math.max(limit,1),500)
  const rows=await sql`SELECT id,actor_email,entry_id,contractor,owner_email,project,work_date::text AS work_date,hours,reason,rejected_at::text AS rejected_at
    FROM entry_rejection_archive
    WHERE (${actorEmail}::text IS NULL OR lower(actor_email)=lower(${actorEmail}))
    ORDER BY rejected_at DESC,id DESC LIMIT ${safeLimit}` as Array<Record<string,unknown>>
  return rows.map(row=>({id:String(row.id),actorEmail:String(row.actor_email),entryId:row.entry_id?String(row.entry_id):null,contractor:String(row.contractor),ownerEmail:row.owner_email?String(row.owner_email):null,project:String(row.project),workDate:row.work_date?String(row.work_date):null,hours:row.hours===null?null:Number(row.hours),reason:String(row.reason),rejectedAt:new Date(String(row.rejected_at)).toISOString()}))
}

/**
 * Saves a submission and its audit event atomically, so callers never see a
 * failed response after the entry was committed without its audit record.
 * @param ownerEmail - Authenticated user whose work is being updated.
 * @param id - Entry identifier.
 * @param patch - Validated fields and submission status.
 * @param includeAll - Whether the caller may update visible team entries.
 * @param reviewerEmail - Authenticated reviewer, when applicable.
 * @param expectedRevision - Revision confirmed by the submitting UI.
 * @param fromStatus - Previously loaded status for audit context.
 * @param actorEmail - Authenticated actor recorded in the audit row.
 * @param metadata - Sanitized audit metadata, containing field names only.
 * @param context - Request metadata captured by the API route.
 * @returns Updated entry, or null when ownership/revision/workflow guards fail.
 */
export async function submitTimeEntryWithAudit(
  ownerEmail: string,
  id: string,
  patch: Partial<ParsedEntry> & { status: "submitted"; reviewManagerEmail: string },
  includeAll: boolean,
  reviewerEmail: string | undefined,
  expectedRevision: string,
  actorEmail: string,
  fromStatus: EntryStatus | null,
  metadata: Record<string, unknown>,
  actorRole: UserRole,
  context: AuditContext,
): Promise<TimeEntry | null> {
  await ensureTimeEntriesTable()
  await ensureAuditEventsTable()
  await ensureWorkflowSettingsTable()
  await ensureTimesheetPeriodsTable()
  await ensureSubmissionExtensionsTable()

  const rows = await sql`WITH changed AS (
    UPDATE time_entries
    SET
      contractor = COALESCE(${patch.contractor ?? null}, contractor),
      work_date = COALESCE(${patch.date ?? null}, work_date),
      hours = COALESCE(${patch.hours ?? null}, hours),
      project = COALESCE(${patch.project ?? null}, project),
      description = COALESCE(${patch.description ?? null}, description),
      status = 'submitted',
      review_manager_email = ${patch.reviewManagerEmail}::text,
      correction_owner_email = NULL,
      correction_due_at = NULL,
      reviewed_by = NULL,
      reviewed_at = NULL,
      review_note = NULL,
      updated_at = now()
    WHERE id = ${id}
      AND (${includeAll} OR lower(owner_email) = lower(${ownerEmail}))
      AND updated_at = ${expectedRevision}::timestamptz
      AND payout_eligible_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM timesheet_periods)
        AND EXISTS (SELECT 1 FROM timesheet_periods p WHERE work_date BETWEEN p.start_date AND p.end_date
          AND (now() <= p.submission_deadline OR (${actorRole}::text = 'manager' AND now() <= p.submission_deadline + make_interval(days => p.manager_grace_days)) OR EXISTS (
            SELECT 1 FROM timesheet_extension_requests x WHERE lower(x.requester_email)=lower(time_entries.owner_email) AND x.period_id=p.id AND x.status='approved' AND x.approved_until>=now()
          ) OR (lower(time_entries.correction_owner_email)=lower(${ownerEmail}) AND time_entries.correction_due_at>=now())))
        OR (NOT EXISTS (SELECT 1 FROM timesheet_periods) AND NOT EXISTS (
          SELECT 1 FROM organization_workflow_settings WHERE id='organization' AND timesheet_submission_deadline <= now()
        ))
      )
      AND (lower(owner_email) <> lower(${ownerEmail}) OR status IN ('draft', 'rejected'))
      AND (status IN ('draft', 'rejected') OR (status = 'submitted' AND ${reviewerEmail ?? null}::text IS NOT NULL))
    RETURNING *
  ), audited AS (
    INSERT INTO audit_events (
      actor_email, action, target_type, target_id, metadata, ip_address,
      user_agent, request_method, request_path, request_id
    )
    SELECT ${actorEmail.toLowerCase()}, 'entry_submitted', 'time_entry', id::text,
      jsonb_build_object(
        'fromStatus', ${fromStatus}::text,
        'toStatus', 'submitted',
        'changedFields', ${JSON.stringify(metadata.changedFields ?? [])}::jsonb,
        'hasReviewNote', ${metadata.hasReviewNote === true}::boolean
      ),
      ${context.ipAddress}::text, ${context.userAgent}::text, ${context.requestMethod}::text,
      ${context.requestPath}::text, ${context.requestId}::text
    FROM changed
    RETURNING target_id
  )
  SELECT id, owner_email, contractor_number, review_manager_email, payout_eligible_at,workflow_origin,correction_owner_email,correction_due_at,
    contractor, work_date, hours, project, description, status, reviewed_by,
    reviewed_at, review_note, updated_at::text AS updated_at
  FROM changed WHERE EXISTS (SELECT 1 FROM audited)`

  return rows.length ? toTimeEntry(rows[0] as TimeEntryRow) : null
}

/**
 * Deletes a single entry when the signed-in user has permission to remove it.
 *
 * Like updates, deletion is guarded directly in SQL. That makes the operation safe
 * even if a client attempts to delete an id that belongs to another user.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param id - Database id of the entry to delete.
 * @param includeAll - Whether elevated roles should bypass owner scoping.
 * @returns A promise that resolves after the delete query completes.
 */
export async function deleteTimeEntry(
  ownerEmail: string,
  id: string,
  includeAll = false,
) {
  await ensureTimeEntriesTable()

  await sql`
    DELETE FROM time_entries
    WHERE id = ${id}
      AND payout_eligible_at IS NULL
      AND (${includeAll} OR owner_email = ${ownerEmail})
      AND (lower(owner_email) <> lower(${ownerEmail}) OR status IN ('draft','rejected'))
  `
}

/**
 * Deletes a bounded set of entries that remain eligible under the SQL-level
 * ownership, workflow, and eligibility locks. Route handlers validate the full
 * business scope before calling this helper; the predicates below close races
 * with a concurrent submission or eligibility update.
 */
export async function deleteTimeEntriesByIds(ownerEmail:string,ids:string[],includeAll=false):Promise<string[]> {
  if(!ids.length)return []
  await ensureTimeEntriesTable()
  const rows=await sql`
    DELETE FROM time_entries
    WHERE id=ANY(${ids}::uuid[])
      AND payout_eligible_at IS NULL
      AND (${includeAll} OR lower(owner_email)=lower(${ownerEmail}))
      AND (lower(owner_email)<>lower(${ownerEmail}) OR status IN ('draft','rejected'))
    RETURNING id
  `
  return rows.map(row=>String(row.id))
}

/**
 * Clears visible entries for the current user or elevated role.
 *
 * For standard users, this clears only their own records. For managers and admins,
 * the same operation clears the currently visible team-wide record set, so the UI
 * only exposes it to elevated roles.
 *
 * @param ownerEmail - Email for the signed-in user.
 * @param includeAll - Whether elevated roles should clear all entries.
 * @returns A promise that resolves after the clear query completes.
 */
export async function clearTimeEntries(ownerEmail: string, includeAll = false):Promise<number> {
  await ensureTimeEntriesTable()

  const rows=await sql`
    DELETE FROM time_entries
    WHERE ${includeAll} OR (
      lower(owner_email)=lower(${ownerEmail}) AND payout_eligible_at IS NULL
      AND (lower(owner_email)<>lower(${ownerEmail}) OR status IN ('draft','rejected'))
    ) RETURNING id
  `
  return rows.length
}
