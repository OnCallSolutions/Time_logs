/**
 * Stores cutoff schedules, suspensions, and expiring operational assignments.
 * Rows are retained when revoked so administrative history remains inspectable.
 * No Microsoft account or session changes are performed by this storage layer.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "./database-initializer"
import type { AccountLifecycle,TemporaryAssignment,TemporaryPermission } from "./access-lifecycle-policy"
const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()

/** @returns Promise<void> after idempotent lifecycle tables and lookup indexes exist. */
async function ensureLifecycle(){
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS account_lifecycle (
      email text PRIMARY KEY,cutoff_at timestamptz,suspended boolean NOT NULL DEFAULT false,
      review_at timestamptz,reason text NOT NULL,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS temporary_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,permissions jsonb NOT NULL,
      scope text NOT NULL CHECK(scope IN ('own','all')),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
      granted_by text NOT NULL,reason text NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(starts_at<ends_at)
    )`
    await sql`CREATE INDEX IF NOT EXISTS temporary_assignments_email_expiry_idx ON temporary_assignments(email,ends_at) WHERE revoked_at IS NULL`
  })
}
const lifecycleProjection=`email,cutoff_at AS "cutoffAt",suspended,review_at AS "reviewAt",reason,updated_by AS "updatedBy"`
const assignmentProjection=`id,email,permissions,scope,starts_at AS "startsAt",ends_at AS "endsAt",granted_by AS "grantedBy",reason,revoked_at AS "revokedAt"`

/** @param email - Authenticated normalized account. @returns Persisted access lifecycle or null. */
export async function getAccountLifecycle(email:string):Promise<AccountLifecycle|null>{
  await ensureLifecycle()
  const rows=await sql.query(`SELECT ${lifecycleProjection} FROM account_lifecycle WHERE email=$1`,[email.toLowerCase()])
  return rows[0] as AccountLifecycle??null
}
/** @param email - Authenticated normalized account. @returns Non-revoked assignments; policy evaluates exact time boundaries. */
export async function getTemporaryAssignments(email:string):Promise<TemporaryAssignment[]>{
  await ensureLifecycle()
  return await sql.query(`SELECT ${assignmentProjection} FROM temporary_assignments WHERE email=$1 AND revoked_at IS NULL AND ends_at>now()`,[email.toLowerCase()]) as TemporaryAssignment[]
}
/** @param actor - Authenticated operator. @param admin - Verified administrator status. @returns Bounded schedules and grant history without credentials. */
export async function listAccessLifecycle(actor:string,admin:boolean){
  await ensureLifecycle()
  const schedules=admin?await sql.query(`SELECT ${lifecycleProjection} FROM account_lifecycle ORDER BY updated_at DESC LIMIT 200`):[]
  const assignments=await sql.query(`SELECT ${assignmentProjection} FROM temporary_assignments WHERE $1 OR granted_by=$2 ORDER BY created_at DESC LIMIT 200`,[admin,actor.toLowerCase()])
  return {schedules,assignments}
}
/** @param input - Admin-validated lifecycle record. @param operation - Explicit action; unrelated state is preserved atomically. @returns Promise<void> after state update and reactivation grant revocation. */
export async function saveAccountLifecycle(input:AccountLifecycle,operation:"schedule_cutoff"|"cancel_cutoff"|"suspend"|"reactivate"){
  await ensureLifecycle()
  const update=sql`INSERT INTO account_lifecycle(email,cutoff_at,suspended,review_at,reason,updated_by)
    VALUES(${input.email.toLowerCase()},${input.cutoffAt},${input.suspended},${input.reviewAt},${input.reason},${input.updatedBy})
    ON CONFLICT(email) DO UPDATE SET
      cutoff_at=CASE WHEN ${operation} IN ('schedule_cutoff','cancel_cutoff','reactivate') THEN EXCLUDED.cutoff_at ELSE account_lifecycle.cutoff_at END,
      suspended=CASE WHEN ${operation} IN ('suspend','reactivate') THEN EXCLUDED.suspended ELSE account_lifecycle.suspended END,
      review_at=CASE WHEN ${operation} IN ('suspend','reactivate') THEN EXCLUDED.review_at ELSE account_lifecycle.review_at END,
      reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()`
  if(operation==="reactivate")await sql.transaction([
    sql`UPDATE temporary_assignments SET revoked_at=now() WHERE revoked_at IS NULL AND (email=${input.email.toLowerCase()} OR granted_by=${input.email.toLowerCase()})`,
    update,
  ])
  else await update
}
/** @param input - Authorized, explicit, time-bounded operational grant. @returns Stored assignment identifier. */
export async function createTemporaryAssignment(input:{email:string;permissions:TemporaryPermission[];scope:"own"|"all";startsAt:string;endsAt:string;grantedBy:string;reason:string}){
  await ensureLifecycle()
  const rows=await sql`INSERT INTO temporary_assignments(email,permissions,scope,starts_at,ends_at,granted_by,reason)
    VALUES(${input.email.toLowerCase()},${JSON.stringify(input.permissions)}::jsonb,${input.scope},${input.startsAt},${input.endsAt},${input.grantedBy.toLowerCase()},${input.reason}) RETURNING id`
  return rows[0].id as string
}
/** @param id - Selected assignment. @param actor - Authenticated grantor/admin. @param admin - Verified administrator authority. @returns Whether an assignment was revoked. */
export async function revokeTemporaryAssignment(id:string,actor:string,admin:boolean){
  await ensureLifecycle()
  const rows=await sql`UPDATE temporary_assignments SET revoked_at=now() WHERE id=${id} AND revoked_at IS NULL AND (${admin} OR granted_by=${actor.toLowerCase()}) RETURNING id`
  return rows.length>0
}
/** @param id - Selected immutable assignment identifier. @returns Assignment state or null for unknown IDs. */
export async function getTemporaryAssignment(id:string):Promise<TemporaryAssignment|null>{
  await ensureLifecycle()
  const rows=await sql.query(`SELECT ${assignmentProjection} FROM temporary_assignments WHERE id=$1`,[id])
  return rows[0] as TemporaryAssignment??null
}
/** @param id - Selected assignment. @param endsAt - Explicit approved new expiry. @param actor - Authenticated operator taking responsibility. @param admin - Verified admin authority. @param reason - Required extension explanation. @returns Whether a non-revoked authorized assignment was extended. */
export async function extendTemporaryAssignment(id:string,endsAt:string,actor:string,admin:boolean,reason:string){
  await ensureLifecycle()
  const rows=await sql`UPDATE temporary_assignments SET ends_at=${endsAt},granted_by=${actor.toLowerCase()},reason=${reason}
    WHERE id=${id} AND revoked_at IS NULL AND (${admin} OR granted_by=${actor.toLowerCase()})
      AND starts_at<${endsAt}::timestamptz AND ends_at<${endsAt}::timestamptz AND ${endsAt}::timestamptz>now() RETURNING id`
  return rows.length>0
}
