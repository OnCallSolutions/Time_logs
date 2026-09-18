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

export async function listTimeEntries(ownerEmail: string) {
  await ensureTimeEntriesTable()

  const rows = await sql`
    SELECT id, contractor, work_date, hours, project, description
    FROM time_entries
    WHERE owner_email = ${ownerEmail}
    ORDER BY work_date DESC, created_at DESC
  `

  return (rows as TimeEntryRow[]).map(toTimeEntry)
}

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

export async function updateTimeEntry(
  ownerEmail: string,
  id: string,
  patch: Partial<ParsedEntry>,
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
      AND owner_email = ${ownerEmail}
    RETURNING id, contractor, work_date, hours, project, description
  `

  const row = (rows as TimeEntryRow[])[0]
  return row ? toTimeEntry(row) : null
}

export async function deleteTimeEntry(ownerEmail: string, id: string) {
  await ensureTimeEntriesTable()

  await sql`
    DELETE FROM time_entries
    WHERE id = ${id}
      AND owner_email = ${ownerEmail}
  `
}

export async function clearTimeEntries(ownerEmail: string) {
  await ensureTimeEntriesTable()

  await sql`
    DELETE FROM time_entries
    WHERE owner_email = ${ownerEmail}
  `
}
