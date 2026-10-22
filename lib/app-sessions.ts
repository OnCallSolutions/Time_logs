/**
 * Tracks revocable sign-in sessions with server-enforced idle and absolute limits.
 * Ordinary authenticated reads never extend activity or issue replacement sessions.
 * Missing legacy session IDs and database failures fail closed rather than resume.
 */
import "server-only"
import {neon} from "@neondatabase/serverless"
import {randomUUID} from "node:crypto"
import {createDatabaseInitializer} from "./database-initializer"
import {SESSION_IDLE_SECONDS,SESSION_MAX_SECONDS,type AppSessionState} from "./session-policy"
import {normalizeEmail} from "./identity-policy"
const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
/** @returns Promise<void> after additive session storage and lookup indexes exist. */
async function ensureSessions():Promise<void>{
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS app_signin_sessions(
      id uuid PRIMARY KEY,email text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      last_activity_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz)`
    await sql`CREATE INDEX IF NOT EXISTS app_signin_sessions_owner_idx ON app_signin_sessions(email,created_at DESC)`
  })
}
/**
 * Creates a new bounded session only after a successful provider sign-in.
 * @param email - Authenticated Microsoft email, never an arbitrary browser target.
 * @returns Promise<string> containing an opaque, non-credential session identifier.
 */
export async function createAppSession(email:string):Promise<string>{
  await ensureSessions();const id=randomUUID()
  await sql`INSERT INTO app_signin_sessions(id,email) VALUES(${id}::uuid,${normalizeEmail(email)})`
  return id
}
/**
 * Validates or touches an existing live session without ever reviving expiry.
 * @param id - Server-issued identifier carried by the authenticated JWT.
 * @param email - Authenticated email binding the session to its original account.
 * @param interactive - True only for the explicit same-origin activity endpoint.
 * @returns Promise<AppSessionState|null> with live server-computed deadlines.
 */
export async function readAppSession(id:string,email:string,interactive=false):Promise<AppSessionState|null>{
  if(!/^[a-f0-9-]{36}$/i.test(id))return null
  await ensureSessions()
  const rows=interactive?await sql`UPDATE app_signin_sessions SET last_activity_at=now()
    WHERE id=${id}::uuid AND email=${normalizeEmail(email)} AND revoked_at IS NULL
      AND created_at>now()-(${SESSION_MAX_SECONDS}*interval '1 second')
      AND last_activity_at>now()-(${SESSION_IDLE_SECONDS}*interval '1 second')
    RETURNING LEAST(created_at+(${SESSION_MAX_SECONDS}*interval '1 second'),last_activity_at+(${SESSION_IDLE_SECONDS}*interval '1 second')) AS "expiresAt",
      created_at+(${SESSION_MAX_SECONDS}*interval '1 second') AS "absoluteExpiresAt"`
    :await sql`SELECT LEAST(created_at+(${SESSION_MAX_SECONDS}*interval '1 second'),last_activity_at+(${SESSION_IDLE_SECONDS}*interval '1 second')) AS "expiresAt",
      created_at+(${SESSION_MAX_SECONDS}*interval '1 second') AS "absoluteExpiresAt"
      FROM app_signin_sessions WHERE id=${id}::uuid AND email=${normalizeEmail(email)} AND revoked_at IS NULL
      AND created_at>now()-(${SESSION_MAX_SECONDS}*interval '1 second')
      AND last_activity_at>now()-(${SESSION_IDLE_SECONDS}*interval '1 second')`
  return rows.length?{expiresAt:new Date(rows[0].expiresAt as string).toISOString(),absoluteExpiresAt:new Date(rows[0].absoluteExpiresAt as string).toISOString()}:null
}

/**
 * Invalidates the current sign-in server-side, including copied session cookies.
 * @param id - Identifier from the signed session token, not a user-supplied target.
 * @returns Promise<void> after idempotent revocation.
 */
export async function revokeAppSession(id:string):Promise<void>{
  await ensureSessions();await sql`UPDATE app_signin_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=${id}::uuid`
}
