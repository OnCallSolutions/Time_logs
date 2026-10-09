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
  id: string
  owner_email?: string
  contractor: string
  work_date: string | Date
  hours: string | number
  project: string
  description: string | null
  status: EntryStatus | null
  reviewed_by: string | null
  reviewed_at: string | Date | null
  review_note: string | null
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
  | "account_lifecycle_updated"
  | "temporary_assignment_created"
  | "temporary_assignment_revoked"
  | "temporary_assignment_extended"
  | "account_handoff_created"
  | "message_sent"
  | "message_edited"
  | "message_deleted"
  | "message_encryption_initialized"
  | "entry_created"
  | "entries_cleared"
  | "entry_updated"
  | "entry_submitted"
  | "entry_recalled"
  | "entry_approved"
  | "entry_rejected"
  | "entry_deleted"
  | "profile_updated"
  | "user_access_created"
  | "user_access_updated"

export type AuditEvent = {
  id: string
  actorEmail: string
  action: AuditAction
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  userAgent: string | null
  occurredAt: string
}

type AuditEventRow = {
  id: string
  actor_email: string
  action: AuditAction
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  occurred_at: string | Date
}

const schemaReady = createDatabaseInitializer()
const profileSchemaReady = createDatabaseInitializer()
const auditSchemaReady = createDatabaseInitializer()
const accessSchemaReady = createDatabaseInitializer()

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
    contractor: row.contractor,
    date:
      row.work_date instanceof Date
        ? row.work_date.toISOString().slice(0, 10)
        : String(row.work_date).slice(0, 10),
    hours: Number(row.hours),
    project: row.project,
    description: row.description ?? "",
    status: row.status ?? "draft",
    reviewedBy: row.reviewed_by,
    reviewedAt:
      row.reviewed_at instanceof Date
        ? row.reviewed_at.toISOString()
        : row.reviewed_at,
    reviewNote: row.review_note,
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
      ADD COLUMN IF NOT EXISTS owner_email text
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
      CREATE INDEX IF NOT EXISTS time_entries_status_work_date_idx
      ON time_entries (status, work_date DESC)
    `
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
        occurred_at timestamptz NOT NULL DEFAULT now()
      )
    `
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
          CHECK (access_status IN ('active', 'denied', 'blocked')),
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
    WHERE owner_email = ${ownerEmail}
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
      user_agent
    )
    VALUES (
      ${event.actorEmail},
      ${event.action},
      ${event.targetType},
      ${event.targetId ?? null},
      ${JSON.stringify(event.metadata ?? {})}::jsonb,
      ${event.ipAddress ?? null},
      ${event.userAgent ?? null}
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
      occurred_at
    FROM audit_events
    ORDER BY occurred_at DESC
    LIMIT ${safeLimit}
  `

  return (rows as AuditEventRow[]).map(toAuditEvent)
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

  const rows = await sql`
    SELECT
      id,
      owner_email,
      contractor,
      work_date,
      hours,
      project,
      description,
      status,
      reviewed_by,
      reviewed_at,
      review_note
    FROM time_entries
    WHERE ${includeAll} OR owner_email = ${ownerEmail}
    ORDER BY work_date DESC, created_at DESC
  `

  return (rows as TimeEntryRow[]).map(toTimeEntry)
}

/**
 * Persists parsed time entries under the signed-in user's email.
 *
 * Creation is always scoped to the caller even when the caller is elevated. This
 * keeps ownership explicit and prevents manager/admin-created entries from being
 * accidentally attributed to another employee.
 *
 * @param ownerEmail - Email that should own the created entries.
 * @param entries - Parsed time entries to insert.
 * @returns Newly created time entries with database ids.
 */
export async function createTimeEntries(
  ownerEmail: string,
  entries: ParsedEntry[],
) {
  await ensureTimeEntriesTable()

  if (entries.length === 0) {
    return []
  }

  const created: TimeEntry[] = []

  for (const entry of entries) {
    const rows = await sql`
      INSERT INTO time_entries (
        contractor,
        work_date,
        hours,
        project,
        description,
        owner_email
      )
      VALUES (
        ${entry.contractor},
        ${entry.date},
        ${entry.hours},
        ${entry.project || "General"},
        ${entry.description || ""},
        ${ownerEmail}
      )
      RETURNING
        id,
        owner_email,
        contractor,
        work_date,
        hours,
        project,
        description,
        status,
        reviewed_by,
        reviewed_at,
        review_note
    `
    created.push(toTimeEntry((rows as TimeEntryRow[])[0]))
  }

  return created
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
      contractor,
      work_date,
      hours,
      project,
      description,
      status,
      reviewed_by,
      reviewed_at,
      review_note
    FROM time_entries
    WHERE id = ${id}
      AND (${includeAll} OR owner_email = ${ownerEmail})
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
 * @returns The updated entry, or null when no visible entry matches.
 */
export async function updateTimeEntry(
  ownerEmail: string,
  id: string,
  patch: Partial<ParsedEntry> & {
    status?: EntryStatus
    reviewNote?: string | null
  },
  includeAll = false,
  reviewerEmail?: string,
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
      AND (${includeAll} OR owner_email = ${ownerEmail})
      AND (${patch.status ?? null} NOT IN ('approved', 'rejected') OR ${patch.status ?? null} IS NULL
        OR (status = 'submitted' AND lower(owner_email) <> lower(${ownerEmail}) AND ${reviewerEmail ?? null} IS NOT NULL))
    RETURNING
      id,
      owner_email,
      contractor,
      work_date,
      hours,
      project,
      description,
      status,
      reviewed_by,
      reviewed_at,
      review_note
  `

  const row = (rows as TimeEntryRow[])[0]
  return row ? toTimeEntry(row) : null
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
      AND (${includeAll} OR owner_email = ${ownerEmail})
  `
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
export async function clearTimeEntries(ownerEmail: string, includeAll = false) {
  await ensureTimeEntriesTable()

  await sql`
    DELETE FROM time_entries
    WHERE ${includeAll} OR owner_email = ${ownerEmail}
  `
}
