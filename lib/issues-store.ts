import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)
const initialize = createDatabaseInitializer()

export type IssueStatus = "open" | "investigating" | "waiting_on_reporter" | "resolved" | "closed"
export type IssuePriority = "low" | "normal" | "high" | "urgent"

export type AppIssue = {
  id: string
  reference: string
  reporterEmail: string
  operation: string
  route: string
  errorSignature: string
  similarReports: number
  httpStatus: number | null
  errorMessage: string
  details: string
  status: IssueStatus
  priority: IssuePriority
  internalNote: string
  createdAt: string
  updatedAt: string
  updatedBy: string | null
}

type IssueRow = {
  id: string; reference: string; reporter_email: string; operation: string; route: string
  error_signature: string; similar_reports: number | string
  http_status: number | null; error_message: string; details: string; status: IssueStatus
  priority: IssuePriority; internal_note: string; created_at: string | Date; updated_at: string | Date
  updated_by: string | null
}

async function ensureIssuesTable() {
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS app_issues (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reference uuid NOT NULL UNIQUE,
      reporter_email text NOT NULL,
      operation text NOT NULL,
      route text NOT NULL,
      error_signature text NOT NULL,
      http_status integer,
      error_message text NOT NULL,
      details text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','waiting_on_reporter','resolved','closed')),
      priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      internal_note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text
    )`;
    await sql`ALTER TABLE app_issues ADD COLUMN IF NOT EXISTS error_signature text`
    await sql`UPDATE app_issues SET error_signature = md5(operation || '|' || route || '|' || error_message) WHERE error_signature IS NULL`
    await sql`ALTER TABLE app_issues ALTER COLUMN error_signature SET NOT NULL`
    await sql`CREATE INDEX IF NOT EXISTS app_issues_status_created_idx ON app_issues (status, created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS app_issues_reporter_created_idx ON app_issues (lower(reporter_email), created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS app_issues_signature_status_idx ON app_issues (error_signature, status, created_at DESC)`
  })
}

function mapIssue(row: IssueRow): AppIssue {
  return {
    id: row.id, reference: row.reference, reporterEmail: row.reporter_email, operation: row.operation,
    route: row.route, errorSignature: row.error_signature, similarReports: Number(row.similar_reports ?? 1), httpStatus: row.http_status, errorMessage: row.error_message, details: row.details,
    status: row.status, priority: row.priority, internalNote: row.internal_note,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by,
  }
}

export async function createIssue(input: {
  reference: string; reporterEmail: string; operation: string; route: string; errorSignature: string; httpStatus: number | null
  errorMessage: string; details: string
}): Promise<{ issue: AppIssue; created: boolean; ownerMatches: boolean }> {
  await ensureIssuesTable()
  const rows = await sql`INSERT INTO app_issues (reference, reporter_email, operation, route, error_signature, http_status, error_message, details)
    VALUES (${input.reference}, ${input.reporterEmail.toLowerCase()}, ${input.operation}, ${input.route}, ${input.errorSignature}, ${input.httpStatus}, ${input.errorMessage}, ${input.details})
    ON CONFLICT (reference) DO UPDATE SET reference = EXCLUDED.reference
    RETURNING *, (xmax = 0) AS was_created`
  const inserted = rows[0] as IssueRow & { was_created: boolean }
  if (inserted.was_created) {
    const counts = await sql`SELECT count(*)::int AS total FROM app_issues WHERE error_signature = ${input.errorSignature} AND status NOT IN ('resolved','closed')`
    const total = Number(counts[0].total)
    const escalation = total >= 5 ? "urgent" : total >= 3 ? "high" : null
    if (escalation) await sql`UPDATE app_issues SET priority = ${escalation} WHERE id = ${inserted.id}`
  }
  const current = await sql`SELECT app_issues.*, count(*) OVER (PARTITION BY error_signature)::int AS similar_reports FROM app_issues WHERE id = ${inserted.id}`
  const issue = mapIssue(current[0] as IssueRow)
  return { issue, created: inserted.was_created, ownerMatches: inserted.reporter_email.toLowerCase() === input.reporterEmail.toLowerCase() }
}

export async function listIssues(): Promise<AppIssue[]> {
  await ensureIssuesTable()
  const rows = await sql`SELECT app_issues.*, count(*) OVER (PARTITION BY error_signature)::int AS similar_reports FROM app_issues ORDER BY CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END, CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC LIMIT 500`
  return (rows as IssueRow[]).map(mapIssue)
}

export async function getIssueSummary(): Promise<{ open: number; urgent: number; uniqueErrors: number }> {
  await ensureIssuesTable()
  const rows = await sql`SELECT count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open,
    count(DISTINCT error_signature) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS unique_errors,
    count(DISTINCT error_signature) FILTER (WHERE status NOT IN ('resolved','closed') AND priority = 'urgent')::int AS urgent FROM app_issues`
  return { open: Number(rows[0].open), uniqueErrors: Number(rows[0].unique_errors), urgent: Number(rows[0].urgent) }
}

export async function updateIssue(input: {
  id: string; status: IssueStatus; priority: IssuePriority; internalNote: string; updatedBy: string
}): Promise<AppIssue | null> {
  await ensureIssuesTable()
  const changed = await sql`UPDATE app_issues SET status = ${input.status}, priority = ${input.priority}, internal_note = ${input.internalNote}, updated_by = ${input.updatedBy.toLowerCase()}, updated_at = now()
    WHERE id = ${input.id} RETURNING id`
  if(!changed[0])return null
  const rows = await sql`SELECT app_issues.*, count(*) OVER (PARTITION BY error_signature)::int AS similar_reports FROM app_issues WHERE id = ${input.id}`
  return rows[0] ? mapIssue(rows[0] as IssueRow) : null
}
