/**
 * Provides employee roster discovery and persistent in-app message storage.
 * Recipient scoping keeps private messages separate from other employees' inboxes.
 * Broadcast visibility is evaluated against the current authorized account role.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { getConfiguredAccessUsers, getEffectiveUserRole } from "@/lib/access"
import { listKnownUsers, listManagedAccessUsers } from "@/lib/db"
import { MESSAGE_EDIT_MINUTES } from "@/lib/message-policy"
import type { EncryptedMessage } from "@/lib/message-crypto"
const sql = neon(process.env.DATABASE_URL!)
let messageSchema:Promise<void>|undefined
/**
 * Lists currently authorized employees and baseline users for delegation/messaging.
 * @returns Promise of email and role pairs, excluding managers and administrators.
 */
export async function employeeRoster() {
  return (await actorRoster()).filter(user=>user.accessStatus === "active" && (user.role === "employee" || user.role === "contractor")).map(user=>({email:user.email,role:user.role}))
}
/**
 * Lists every configured, managed, or observed actor without security-log data.
 * Assigned roles stay visible for blocked accounts, but their rights remain denied.
 * @returns Promise containing public directory identity, role, and access summaries.
 */
export async function actorRoster() {
  const [known,managed] = await Promise.all([listKnownUsers(),listManagedAccessUsers()])
  const configured=getConfiguredAccessUsers()
  const emails = new Set([...known,...managed,...configured].map(user=>user.email.toLowerCase()))
  const users = await Promise.all([...emails].map(async email=>{
    const effective=await getEffectiveUserRole(email)
    const assignment=managed.find(user=>user.email.toLowerCase()===email)
    return {email,role:effective??assignment?.role??configured.find(user=>user.email.toLowerCase()===email)?.role??"none",accessStatus:effective?"active":assignment?.accessStatus??"observed",displayName:known.find(user=>user.email.toLowerCase()===email)?.displayName??""}
  }))
  const rank:Record<string,number>={admin:4,manager:3,account_manager:3,employee:2,contractor:1,none:0}
  return users.sort((a,b)=>(rank[b.role]??0)-(rank[a.role]??0)||a.email.localeCompare(b.email))
}
/**
 * Creates message storage and its recipient/date index without changing records.
 * @returns Promise<void> when the idempotent schema statements complete.
 */
async function initializeMessages(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS app_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sender_email TEXT NOT NULL,
    recipient_email TEXT, body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`CREATE INDEX IF NOT EXISTS app_messages_recipient_date_idx ON app_messages (recipient_email,created_at DESC)`
  await sql`ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`
  await sql`ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS encrypted_payload JSONB`
  await sql`CREATE TABLE IF NOT EXISTS app_message_receipts (
    message_id UUID NOT NULL REFERENCES app_messages(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL, delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, recipient_email)
  )`
}
/**
 * Reuses schema initialization instead of running DDL on each inbox poll.
 * @returns Promise<void> with transient initialization failures remaining retryable.
 */
function ensureMessages():Promise<void>{
  return messageSchema??=initializeMessages().catch(error=>{messageSchema=undefined;throw error})
}
/**
 * Lists private received/sent messages and permitted employee broadcasts.
 * @param email - Current authenticated identity.
 * @param receivesBroadcast - Whether the current role receives employee broadcasts.
 * @returns Promise of at most 100 recent authorized messages.
 */
export async function listMessages(email:string,receivesBroadcast:boolean) {
  await ensureMessages()
  const identity = email.toLowerCase()
  await sql`INSERT INTO app_message_receipts (message_id,recipient_email)
    SELECT id,${identity} FROM app_messages WHERE sender_email <> ${identity} AND deleted_at IS NULL
      AND (recipient_email = ${identity} OR (recipient_email IS NULL AND ${receivesBroadcast} AND (encrypted_payload IS NULL OR encrypted_payload->'keys' ? ${identity})))
    ORDER BY created_at DESC LIMIT 100 ON CONFLICT DO NOTHING`
  return sql`SELECT m.id,m.sender_email,m.recipient_email,m.body,m.created_at,m.edited_at,m.deleted_at,m.encrypted_payload,
    r.delivered_at,r.read_at,
    (SELECT COUNT(*)::int FROM app_message_receipts WHERE message_id=m.id) AS delivered_count,
    (SELECT COUNT(*)::int FROM app_message_receipts WHERE message_id=m.id AND read_at IS NOT NULL) AS read_count
    FROM app_messages m LEFT JOIN app_message_receipts r ON r.message_id=m.id
      AND r.recipient_email=CASE WHEN m.sender_email=${identity} AND m.recipient_email IS NOT NULL THEN m.recipient_email ELSE ${identity} END
    WHERE m.recipient_email = ${identity} OR m.sender_email = ${identity}
      OR (m.recipient_email IS NULL AND ${receivesBroadcast} AND (m.encrypted_payload IS NULL OR m.encrypted_payload->'keys' ? ${identity})) ORDER BY m.created_at DESC LIMIT 100`
}

/**
 * Records read acknowledgments only for messages visible to this recipient.
 * @param email - Current authenticated recipient, never accepted from request data.
 * @param receivesBroadcast - Whether the account receives employee broadcasts.
 * @param ids - Explicitly opened message IDs.
 * @returns Promise<void> after idempotent receipt updates.
 */
export async function readMessages(email: string, receivesBroadcast: boolean, ids: string[]): Promise<void> {
  await ensureMessages()
  await sql`INSERT INTO app_message_receipts (message_id,recipient_email,read_at)
    SELECT id,${email.toLowerCase()},NOW() FROM app_messages WHERE id=ANY(${ids}::uuid[])
      AND sender_email<>${email.toLowerCase()} AND deleted_at IS NULL
      AND (recipient_email=${email.toLowerCase()} OR (recipient_email IS NULL AND ${receivesBroadcast} AND (encrypted_payload IS NULL OR encrypted_payload->'keys' ? ${email.toLowerCase()})))
    ON CONFLICT (message_id,recipient_email) DO UPDATE SET read_at=COALESCE(app_message_receipts.read_at,EXCLUDED.read_at)`
}

/**
 * Atomically edits or tombstones a scoped message with server-side deadlines.
 * @param email - Authenticated actor identity.
 * @param admin - Whether the actor may moderate visible messages without a deadline.
 * @param id - Target message UUID.
 * @param body - Replacement plain text, or null to delete for all participants.
 * @param encrypted - Signed ciphertext for edits; prevents plaintext downgrade.
 * @returns Promise<boolean> indicating whether an authorized mutation occurred.
 */
export async function changeMessage(email: string, admin: boolean, id: string, body: string | null, encrypted?:EncryptedMessage): Promise<boolean> {
  await ensureMessages()
  const rows = body === null
    ? await sql`UPDATE app_messages SET body='[Message deleted]',encrypted_payload=NULL,deleted_at=NOW()
      WHERE id=${id} AND deleted_at IS NULL AND (sender_email=${email.toLowerCase()} OR (${admin} AND recipient_email=${email.toLowerCase()})) RETURNING id`
    : await sql`UPDATE app_messages SET body=${encrypted?"[Encrypted message]":body},encrypted_payload=${encrypted?JSON.stringify(encrypted):null}::jsonb,edited_at=NOW()
      WHERE id=${id} AND deleted_at IS NULL
        AND (encrypted_payload IS NULL OR ${encrypted!==undefined})
        AND (sender_email=${email.toLowerCase()} OR (${admin} AND recipient_email=${email.toLowerCase()}))
        AND (${admin} OR created_at>NOW()-(${MESSAGE_EDIT_MINUTES} * INTERVAL '1 minute')) RETURNING id`
  return rows.length > 0
}
/**
 * Saves a manager-authored private message or employee broadcast.
 * @param sender - Authenticated sender email.
 * @param recipient - Validated employee email, or null for all employees.
 * @param body - Validated plain-text message.
 * @param encrypted - Signed ciphertext stored instead of the plaintext placeholder.
 * @returns Promise containing the newly stored message ID.
 */
export async function sendMessage(sender:string,recipient:string|null,body:string,encrypted?:EncryptedMessage) {
  await ensureMessages()
  const rows = await sql`INSERT INTO app_messages (sender_email,recipient_email,body,encrypted_payload)
    VALUES (${sender.toLowerCase()},${recipient?.toLowerCase() ?? null},${encrypted?"[Encrypted message]":body},${encrypted?JSON.stringify(encrypted):null}::jsonb) RETURNING id`
  return rows[0].id as string
}

/** @param email - Authenticated actor. @param admin - Moderation capability. @param id - Message UUID. @returns Scoped original message or null for unauthorized IDs. */
export async function editableMessage(email:string,admin:boolean,id:string){
  await ensureMessages();const rows=await sql`SELECT * FROM app_messages WHERE id=${id} AND deleted_at IS NULL AND (sender_email=${email.toLowerCase()} OR (${admin} AND recipient_email=${email.toLowerCase()}))`
  return rows[0]??null
}
