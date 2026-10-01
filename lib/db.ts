/**
 * Provides Neon database accessors for persistent time entry storage.
 *
 * This module owns the SQL used by the app and keeps role-aware row scoping close
 * to the data operations. API routes pass in the signed-in email plus an elevated
 * visibility flag, and these helpers enforce that scope in every query.
 */
import "server-only"

import { neon } from "@neondatabase/serverless"
import type { ParsedEntry, TimeEntry } from "@/lib/types"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.")
}

const sql = neon(databaseUrl)

type TimeEntryRow = {
  id: string
  contractor: string
  work_date: string | Date
  hours: string | number
  project: string
  description: string | null
}

let schemaReady: Promise<void> | null = null

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
    contractor: row.contractor,
    date:
      row.work_date instanceof Date
        ? row.work_date.toISOString().slice(0, 10)
        : String(row.work_date).slice(0, 10),
    hours: Number(row.hours),
    project: row.project,
    description: row.description ?? "",
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
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS time_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor text NOT NULL,
        work_date date NOT NULL,
        hours numeric(8, 2) NOT NULL CHECK (hours >= 0),
        project text NOT NULL DEFAULT 'General',
        description text NOT NULL DEFAULT '',
        owner_email text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`
      ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS owner_email text
    `
    await sql`
      CREATE INDEX IF NOT EXISTS time_entries_owner_email_created_at_idx
      ON time_entries (owner_email, created_at DESC)
    `
  })()

  return schemaReady
}

/**
 * Lists entries for the current owner or all entries for elevated roles.
 *
 * Regular users and workers only receive rows tied to their email. Managers and
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
    SELECT id, contractor, work_date, hours, project, description
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
 * accidentally attributed to another worker.
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
      RETURNING id, contractor, work_date, hours, project, description
    `
    created.push(toTimeEntry((rows as TimeEntryRow[])[0]))
  }

  return created
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
  patch: Partial<ParsedEntry>,
  includeAll = false,
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
      updated_at = now()
    WHERE id = ${id}
      AND (${includeAll} OR owner_email = ${ownerEmail})
    RETURNING id, contractor, work_date, hours, project, description
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
