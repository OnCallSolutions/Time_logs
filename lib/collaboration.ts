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
import { listAccountIdentities } from "@/lib/account-identities"
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
export async function actorRoster():Promise<{email:string;role:string;accessStatus:string;displayName:string;contractorNumber?:string|null}[]> {
  const [known,managed,identities] = await Promise.all([listKnownUsers(),listManagedAccessUsers(),listAccountIdentities()])
  const configured=getConfiguredAccessUsers()
  const emails = new Set([...known,...managed,...configured].map(user=>user.email.toLowerCase()))
  const users = await Promise.all([...emails].map(async email=>{
    const effective=await getEffectiveUserRole(email)
    const assignment=managed.find(user=>user.email.toLowerCase()===email)
    const identity=identities.find(user=>user.email===email)
    return {email,role:effective??assignment?.role??configured.find(user=>user.email.toLowerCase()===email)?.role??"none",accessStatus:effective?"active":assignment?.accessStatus==="active"?"denied":assignment?.accessStatus??"observed",displayName:identity?.officialName??"",contractorNumber:identity?.contractorNumber??null}
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
  await sql`ALTER TABLE app_messages ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high'))`
  await sql`CREATE TABLE IF NOT EXISTS app_message_receipts (
    message_id UUID NOT NULL REFERENCES app_messages(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL, delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ, read_receipt_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, recipient_email)
  )`
  await sql`ALTER TABLE app_message_receipts ADD COLUMN IF NOT EXISTS read_receipt_at TIMESTAMPTZ`
  await sql`CREATE TABLE IF NOT EXISTS app_message_preferences (
    account_email TEXT PRIMARY KEY, read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`CREATE TABLE IF NOT EXISTS app_message_hidden_for (
    message_id UUID NOT NULL REFERENCES app_messages(id) ON DELETE CASCADE,
    account_email TEXT NOT NULL, hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(message_id,account_email)
  )`
}
/**
 * Reuses schema initialization instead of running DDL on each inbox poll.
 * @returns Promise<void> with transient initialization failures remaining retryable.
 */
export function ensureMessages():Promise<void>{
  return messageSchema??=initializeMessages().catch(error=>{messageSchema=undefined;throw error})
}
/**
 * Finds original verification authors across the caller's full encrypted history.
 * @param email - Authenticated participant; public keys do not grant message access.
 * @returns Promise<string[]> containing historical signing identities only.
 */
export async function messageAuthors(email:string):Promise<string[]>{
  await ensureMessages()
  const rows=await sql`SELECT DISTINCT encrypted_payload->>'author' AS email FROM app_messages
    WHERE encrypted_payload IS NOT NULL AND (sender_email=${email.toLowerCase()} OR recipient_email=${email.toLowerCase()} OR encrypted_payload->'keys' ? ${email.toLowerCase()})`
  return rows.flatMap(row=>typeof row.email==="string"?[row.email]:[])
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
      AND NOT EXISTS(SELECT 1 FROM app_message_hidden_for h WHERE h.message_id=app_messages.id AND h.account_email=${identity})
      AND (recipient_email = ${identity} OR (recipient_email IS NULL AND (encrypted_payload->'keys' ? ${identity} OR (${receivesBroadcast} AND encrypted_payload IS NULL))))
    ORDER BY created_at DESC,id DESC LIMIT 100 ON CONFLICT DO NOTHING`
  return sql`SELECT m.id,m.sender_email,m.recipient_email,m.body,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,m.edited_at,m.deleted_at,m.encrypted_payload,m.priority,
    r.delivered_at,CASE WHEN m.sender_email=${identity} THEN r.read_receipt_at ELSE r.read_at END AS read_at,
    (SELECT COUNT(*)::int FROM app_message_receipts WHERE message_id=m.id) AS delivered_count,
    (SELECT COUNT(*)::int FROM app_message_receipts WHERE message_id=m.id AND read_receipt_at IS NOT NULL) AS read_count
    FROM app_messages m LEFT JOIN app_message_receipts r ON r.message_id=m.id
      AND r.recipient_email=CASE WHEN m.sender_email=${identity} AND m.recipient_email IS NOT NULL THEN m.recipient_email ELSE ${identity} END
    WHERE (m.recipient_email = ${identity} OR m.sender_email = ${identity}
      OR (m.recipient_email IS NULL AND (m.encrypted_payload->'keys' ? ${identity} OR (${receivesBroadcast} AND m.encrypted_payload IS NULL))))
      AND NOT EXISTS(SELECT 1 FROM app_message_hidden_for h WHERE h.message_id=m.id AND h.account_email=${identity})
    ORDER BY m.created_at DESC,m.id DESC LIMIT 100`
}

/** @param email - Authenticated account identity. @returns Its persistent messaging privacy preference. */
export async function getMessagePreferences(email:string):Promise<{readReceiptsEnabled:boolean}>{
  await ensureMessages()
  const rows=await sql`SELECT read_receipts_enabled FROM app_message_preferences WHERE account_email=${email.toLowerCase()} LIMIT 1`
  return {readReceiptsEnabled:rows[0]?.read_receipts_enabled!==false}
}

/** @param email - Authenticated account identity. @param enabled - Whether opened messages disclose read receipts. @returns Promise<void> after preference persistence. */
export async function setReadReceiptsEnabled(email:string,enabled:boolean):Promise<void>{
  await ensureMessages()
  await sql`INSERT INTO app_message_preferences(account_email,read_receipts_enabled) VALUES(${email.toLowerCase()},${enabled})
    ON CONFLICT(account_email) DO UPDATE SET read_receipts_enabled=EXCLUDED.read_receipts_enabled,updated_at=NOW()`
}

/**
 * Checks that two accounts share a visible conversation before revealing an avatar.
 * @param viewer - Authenticated account requesting the other participant's image.
 * @param participant - Account whose profile image is requested.
 * @param receivesBroadcast - Whether the viewer may see legacy workforce announcements.
 * @returns Promise<boolean> indicating an existing shared message relationship.
 */
export async function canViewMessageProfile(viewer:string,participant:string,receivesBroadcast:boolean):Promise<boolean>{
  await ensureMessages()
  const current=viewer.toLowerCase(),other=participant.toLowerCase()
  if(current===other)return false
  const rows=await sql`SELECT 1 FROM app_messages WHERE
    ((sender_email=${current} AND recipient_email=${other}) OR (sender_email=${other} AND recipient_email=${current}))
    OR (sender_email=${other} AND recipient_email IS NULL AND
      (encrypted_payload->'keys' ? ${current} OR (${receivesBroadcast} AND encrypted_payload IS NULL)))
    LIMIT 1`
  return rows.length>0
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
  await sql`INSERT INTO app_message_receipts (message_id,recipient_email,read_at,read_receipt_at)
    SELECT id,${email.toLowerCase()},NOW(),CASE WHEN COALESCE((SELECT read_receipts_enabled FROM app_message_preferences WHERE account_email=${email.toLowerCase()}),TRUE) THEN NOW() ELSE NULL END FROM app_messages WHERE id=ANY(${ids}::uuid[])
      AND sender_email<>${email.toLowerCase()} AND deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM app_message_hidden_for h WHERE h.message_id=app_messages.id AND h.account_email=${email.toLowerCase()})
      AND (recipient_email=${email.toLowerCase()} OR (recipient_email IS NULL AND (encrypted_payload->'keys' ? ${email.toLowerCase()} OR (${receivesBroadcast} AND encrypted_payload IS NULL))))
    ON CONFLICT (message_id,recipient_email) DO UPDATE SET read_at=COALESCE(app_message_receipts.read_at,EXCLUDED.read_at),
      read_receipt_at=COALESCE(app_message_receipts.read_receipt_at,EXCLUDED.read_receipt_at)`
}

/**
 * Hides a message only from the authenticated account while preserving other inboxes.
 * @param email - Authenticated viewer identity.
 * @param receivesBroadcast - Whether the viewer may see legacy broadcasts.
 * @param id - Message UUID selected from the UI.
 * @returns Promise<boolean> indicating a visible message was hidden for this account.
 */
export async function hideMessageFor(email:string,receivesBroadcast:boolean,id:string):Promise<boolean>{
  await ensureMessages()
  const identity=email.toLowerCase()
  const rows=await sql`INSERT INTO app_message_hidden_for(message_id,account_email)
    SELECT m.id,${identity} FROM app_messages m WHERE m.id=${id} AND m.deleted_at IS NULL
      AND (m.sender_email=${identity} OR m.recipient_email=${identity} OR (m.recipient_email IS NULL AND
        (m.encrypted_payload->'keys' ? ${identity} OR (${receivesBroadcast} AND m.encrypted_payload IS NULL))))
    ON CONFLICT(message_id,account_email) DO NOTHING RETURNING message_id`
  return rows.length>0
}

/**
 * Atomically edits or tombstones a scoped message with server-side deadlines.
 * @param email - Authenticated actor identity.
 * @param admin - Whether the sender may edit their own message without a deadline.
 * @param id - Target message UUID.
 * @param body - Replacement plain text, or null to delete for all participants.
 * @param encrypted - Signed ciphertext for edits; prevents plaintext downgrade.
 * @returns Promise<boolean> indicating whether an authorized mutation occurred.
 */
export async function changeMessage(email: string, admin: boolean, id: string, body: string | null, encrypted?:EncryptedMessage): Promise<boolean> {
  await ensureMessages()
  const rows = body === null
    ? await sql`UPDATE app_messages SET body='[Message deleted]',encrypted_payload=NULL,deleted_at=NOW()
      WHERE id=${id} AND deleted_at IS NULL AND (sender_email=${email.toLowerCase()} OR ${admin})
        AND (${admin} OR (sender_email=${email.toLowerCase()} AND created_at>NOW()-(${MESSAGE_EDIT_MINUTES} * INTERVAL '1 minute'))) RETURNING id`
    : await sql`UPDATE app_messages SET body=${encrypted?"[Encrypted message]":body},encrypted_payload=${encrypted?JSON.stringify(encrypted):null}::jsonb,edited_at=NOW()
      WHERE id=${id} AND deleted_at IS NULL AND sender_email=${email.toLowerCase()}
        AND (encrypted_payload IS NULL OR ${encrypted!==undefined})
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
  const rows = await sql`INSERT INTO app_messages (id,sender_email,recipient_email,body,encrypted_payload)
    VALUES (COALESCE(${encrypted?.token??null}::uuid,gen_random_uuid()),${sender.toLowerCase()},${recipient?.toLowerCase() ?? null},${encrypted?"[Encrypted message]":body},${encrypted?JSON.stringify(encrypted):null}::jsonb)
    ON CONFLICT(id) DO UPDATE SET id=app_messages.id
      WHERE app_messages.sender_email=EXCLUDED.sender_email AND app_messages.encrypted_payload=EXCLUDED.encrypted_payload
    RETURNING id`
  if(!rows.length)throw new Error("Message retry identity conflict.")
  return rows[0].id as string
}

/** @param email - Authenticated actor. @param id - Message UUID. @returns Original message only when the authenticated actor is its sender. */
export async function editableMessage(email:string,id:string){
  await ensureMessages();const rows=await sql`SELECT * FROM app_messages WHERE id=${id} AND deleted_at IS NULL AND sender_email=${email.toLowerCase()}`
  return rows[0]??null
}
