/**
 * Stores signed, account-scoped history key transfers without message plaintext.
 * Pagination traverses complete authorized history instead of a recent-inbox limit.
 * Shares never mutate original envelopes and are invalidated by edits or deletion.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureMessages } from "./collaboration"
import { createDatabaseInitializer } from "./database-initializer"
import type { AppMessage } from "./message-policy"
import type { HistoryShare } from "./message-history-crypto"
const sql = neon(process.env.DATABASE_URL!)
const initialize = createDatabaseInitializer()
/** @returns Promise<void> once ciphertext-only transfer storage exists. */
async function ensureHistory(): Promise<void> {
  await ensureMessages()
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS app_message_history_shares(
      message_id uuid NOT NULL REFERENCES app_messages(id) ON DELETE CASCADE,owner_email text NOT NULL,
      target_fingerprint text NOT NULL,source_signature text NOT NULL,share jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(message_id,owner_email,target_fingerprint))`
  })
}
/**
 * Pages historical ciphertext using immutable creation order, scoped to participation.
 * @param owner - Authenticated email; knowledge of IDs alone never grants access.
 * @param before - Optional cursor from a preceding authorized response.
 * @param receivesBroadcast - Whether legacy workforce broadcasts are visible.
 * @returns Promise<AppMessage[]> with up to fifty original messages.
 */
export async function historyPage(owner: string, before: { date: string; id: string } | null, receivesBroadcast: boolean): Promise<AppMessage[]> {
  await ensureHistory()
  return await sql`SELECT m.id,m.sender_email,m.recipient_email,m.body,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,m.edited_at,m.deleted_at,m.encrypted_payload,m.priority,
    r.delivered_at,r.read_at,(SELECT count(*)::int FROM app_message_receipts WHERE message_id=m.id) AS delivered_count,
    (SELECT count(*)::int FROM app_message_receipts WHERE message_id=m.id AND read_at IS NOT NULL) AS read_count
    FROM app_messages m LEFT JOIN app_message_receipts r ON r.message_id=m.id
      AND r.recipient_email=CASE WHEN m.sender_email=${owner.toLowerCase()} AND m.recipient_email IS NOT NULL THEN m.recipient_email ELSE ${owner.toLowerCase()} END
    WHERE (m.sender_email=${owner.toLowerCase()} OR m.recipient_email=${owner.toLowerCase()} OR (m.recipient_email IS NULL AND
      (m.encrypted_payload->'keys' ? ${owner.toLowerCase()} OR (${receivesBroadcast} AND m.encrypted_payload IS NULL))))
    AND NOT EXISTS(SELECT 1 FROM app_message_hidden_for h WHERE h.message_id=m.id AND h.account_email=${owner.toLowerCase()})
    AND (${before === null} OR (m.created_at,m.id)<(${before?.date ?? "9999-01-01"}::timestamptz,${before?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 50` as AppMessage[]
}
/**
 * Refreshes already-loaded historical messages, including receipts and tombstones.
 * @param owner - Authenticated participant identity.
 * @param ids - Bounded previously loaded IDs; possession alone does not grant access.
 * @param receivesBroadcast - Whether legacy workforce broadcasts are permitted.
 * @returns Promise<AppMessage[]> containing only still-authorized records.
 */
export async function historyByIds(owner:string,ids:string[],receivesBroadcast:boolean):Promise<AppMessage[]>{
  await ensureHistory()
  return await sql`SELECT m.id,m.sender_email,m.recipient_email,m.body,m.created_at,m.edited_at,m.deleted_at,m.encrypted_payload,m.priority,
    r.delivered_at,r.read_at,(SELECT count(*)::int FROM app_message_receipts WHERE message_id=m.id) AS delivered_count,
    (SELECT count(*)::int FROM app_message_receipts WHERE message_id=m.id AND read_at IS NOT NULL) AS read_count
    FROM app_messages m LEFT JOIN app_message_receipts r ON r.message_id=m.id
      AND r.recipient_email=CASE WHEN m.sender_email=${owner.toLowerCase()} AND m.recipient_email IS NOT NULL THEN m.recipient_email ELSE ${owner.toLowerCase()} END
    WHERE m.id=ANY(${ids}::uuid[]) AND (m.sender_email=${owner.toLowerCase()} OR m.recipient_email=${owner.toLowerCase()}
      OR (m.recipient_email IS NULL AND (m.encrypted_payload->'keys' ? ${owner.toLowerCase()} OR (${receivesBroadcast} AND m.encrypted_payload IS NULL))))
      AND NOT EXISTS(SELECT 1 FROM app_message_hidden_for h WHERE h.message_id=m.id AND h.account_email=${owner.toLowerCase()})` as AppMessage[]
}
/**
 * Retrieves transfers only for the current account and selected registered target.
 * @param owner - Authenticated account identity.
 * @param fingerprint - Validated own-device fingerprint.
 * @param ids - Explicit message IDs from an authorized history page.
 * @returns Promise<HistoryShare[]> containing usable current-revision transfers.
 */
export async function historyShares(owner: string, fingerprint: string, ids: string[]): Promise<HistoryShare[]> {
  await ensureHistory()
  const rows = await sql`SELECT s.share FROM app_message_history_shares s JOIN app_messages m ON m.id=s.message_id
    WHERE s.owner_email=${owner.toLowerCase()} AND s.target_fingerprint=${fingerprint} AND s.message_id=ANY(${ids}::uuid[])
      AND m.deleted_at IS NULL AND s.source_signature=m.encrypted_payload->>'signature'`
  return rows.map(row => row.share as HistoryShare)
}
/**
 * Stores a validated own-device transfer while rechecking participation and revision.
 * @param owner - Authenticated account, shared by source and target device keys.
 * @param share - Public-signature-validated transfer envelope.
 * @returns Promise<boolean> indicating whether unchanged authorized evidence was stored.
 */
export async function saveHistoryShare(owner: string, share: HistoryShare): Promise<boolean> {
  await ensureHistory()
  const rows = await sql`INSERT INTO app_message_history_shares(message_id,owner_email,target_fingerprint,source_signature,share)
    SELECT id,${owner.toLowerCase()},${share.targetFingerprint},${share.sourceSignature},${JSON.stringify(share)}::jsonb FROM app_messages
    WHERE id=${share.messageId}::uuid AND deleted_at IS NULL AND encrypted_payload->>'signature'=${share.sourceSignature}
      AND encrypted_payload->'keys' ? ${owner.toLowerCase()}
    ON CONFLICT(message_id,owner_email,target_fingerprint) DO UPDATE SET source_signature=EXCLUDED.source_signature,share=EXCLUDED.share,created_at=now()
    RETURNING message_id`
  return rows.length === 1
}
