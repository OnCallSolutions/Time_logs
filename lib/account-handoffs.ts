/**
 * Stores reviewed contractor work assigned to a business-account reviewer.
 * Handoffs capture approved evidence without calculating or releasing payments.
 * Queue reads flag records whose source approval or revision is no longer current.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureTimeEntriesTable } from "./db"
import { createDatabaseInitializer } from "./database-initializer"
const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()

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
export async function createHandoffs(ids:string[],actor:string,recipient:string,includeAll:boolean){
  await ensureHandoffs()
  return sql`INSERT INTO account_handoffs(entry_id,assigned_to,handed_by,source_updated_at,evidence)
    SELECT id,${recipient.toLowerCase()},${actor.toLowerCase()},updated_at,
      jsonb_build_object('contractor',contractor,'ownerEmail',owner_email,'date',work_date,'hours',hours,'project',project,'description',description,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at)
    FROM time_entries WHERE id=ANY(${ids}::uuid[]) AND status='approved'
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
export async function listHandoffs(email:string,admin:boolean){
  await ensureHandoffs()
  return sql`SELECT h.id,h.entry_id,h.assigned_to,h.handed_by,h.evidence,h.created_at,
    (e.status='approved' AND e.updated_at=h.source_updated_at) AS current
    FROM account_handoffs h JOIN time_entries e ON e.id=h.entry_id
    WHERE ${admin} OR h.assigned_to=${email.toLowerCase()}
    ORDER BY h.created_at DESC LIMIT 100`
}
