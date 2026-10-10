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
export const accountReviewStates=["pending","needs_information","ready_for_finance","archived"] as const
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
      AND (${admin} OR h.assigned_to=${actor.toLowerCase()})
      AND (${state} <> 'ready_for_finance' OR (e.status='approved' AND e.updated_at=h.source_updated_at AND lower(e.owner_email)<>${actor.toLowerCase()}))
    RETURNING h.id,h.review_version`
  return rows.length?{id:String(rows[0].id),review_version:Number(rows[0].review_version)}:null
}
