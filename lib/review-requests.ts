/**
 * Stores short-lived, revision-bound reviewer requests alongside encrypted notices.
 * A single SQL statement creates the message and every scoped grant atomically.
 * Nothing here grants global role permissions or allows approval of one's own work.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureTimeEntriesTable } from "./db"
import { ensureMessages } from "./collaboration"
import { createDatabaseInitializer } from "./database-initializer"
import type { EncryptedMessage } from "./message-crypto"
const sql = neon(process.env.DATABASE_URL!)
const initialize = createDatabaseInitializer()
export type ReviewRequest = { entry_id: string; sender_email: string; recipient_email: string; source_revision: string; message_id: string; expires_at: string }

/** @returns Promise<void> after request storage and participant indexes exist. */
async function ensureRequests(): Promise<void> {
  await ensureTimeEntriesTable(); await ensureMessages()
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS entry_review_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL REFERENCES time_entries(id),
      sender_email text NOT NULL,recipient_email text NOT NULL,source_revision timestamptz NOT NULL,
      message_id uuid NOT NULL REFERENCES app_messages(id),created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now()+interval '48 hours'),
      CHECK(sender_email<>recipient_email),UNIQUE(entry_id,message_id)
    )`
    await sql`CREATE INDEX IF NOT EXISTS entry_review_requests_recipient_idx ON entry_review_requests(recipient_email,expires_at)`
  })
}

/**
 * Reads only the caller's requests whose evidence is still submitted and unchanged.
 * @param email - Authenticated recipient; sender authority is rechecked by the caller.
 * @returns Promise<ReviewRequest[]> with bounded active grants, not message plaintext.
 */
export async function listReviewRequests(email: string): Promise<ReviewRequest[]> {
  await ensureRequests()
  return await sql`SELECT r.entry_id,r.sender_email,r.recipient_email,r.source_revision::text AS source_revision,r.message_id,r.expires_at
    FROM entry_review_requests r JOIN time_entries e ON e.id=r.entry_id
    WHERE r.recipient_email=${email.toLowerCase()} AND r.expires_at>now()
      AND e.status='submitted' AND e.updated_at=r.source_revision
      AND lower(e.owner_email)<>${email.toLowerCase()}
    ORDER BY r.created_at DESC LIMIT 500` as unknown as ReviewRequest[]
}

/**
 * Locks selected evidence and inserts one encrypted high-priority notice plus grants.
 * @param selection - Exact IDs/revisions validated against sender review authority.
 * @param sender - Authenticated requesting manager/admin.
 * @param recipient - Active manager accepting delegated requests, never an evidence owner.
 * @param messageId - Client UUID binding retries to the same message transaction.
 * @param encrypted - Validated end-to-end encrypted notice; no plaintext is stored.
 * @returns Promise<number> containing all created grants, or zero when evidence changed.
 */
export async function createReviewRequests(selection: { id: string; revision: string }[], sender: string, recipient: string, messageId: string, encrypted: EncryptedMessage): Promise<number> {
  if(!selection.length||selection.length>50||new Set(selection.map(row=>row.id)).size!==selection.length||sender.toLowerCase()===recipient.toLowerCase())return 0
  await ensureRequests()
  const rows = await sql`WITH requested AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(selection)}::jsonb) AS x(id uuid,revision timestamptz)
    ), locked AS MATERIALIZED (
      SELECT e.id,e.updated_at FROM time_entries e JOIN requested r ON r.id=e.id
      WHERE e.status='submitted' AND e.updated_at=r.revision AND lower(e.owner_email)<>${recipient.toLowerCase()}
      ORDER BY e.id FOR UPDATE OF e
    ), notice AS (
      INSERT INTO app_messages(id,sender_email,recipient_email,body,encrypted_payload,priority)
      SELECT ${messageId}::uuid,${sender.toLowerCase()},${recipient.toLowerCase()},'[Encrypted message]',${JSON.stringify(encrypted)}::jsonb,'high'
      WHERE (SELECT count(*) FROM locked)=${selection.length}
      ON CONFLICT(id) DO NOTHING RETURNING id
    ) INSERT INTO entry_review_requests(entry_id,sender_email,recipient_email,source_revision,message_id)
      SELECT l.id,${sender.toLowerCase()},${recipient.toLowerCase()},l.updated_at,n.id FROM locked l CROSS JOIN notice n
      RETURNING id`
  return rows.length
}
