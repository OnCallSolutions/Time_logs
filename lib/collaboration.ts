/**
 * Provides employee roster discovery and persistent in-app message storage.
 * Recipient scoping keeps private messages separate from other employees' inboxes.
 * Broadcast visibility is evaluated against the current authorized account role.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { getConfiguredAccessUsers, getEffectiveUserRole } from "@/lib/access"
import { listKnownUsers, listManagedAccessUsers } from "@/lib/db"
const sql = neon(process.env.DATABASE_URL!)
/**
 * Lists currently authorized employees and baseline users for delegation/messaging.
 * @returns Promise of email and role pairs, excluding managers and administrators.
 */
export async function employeeRoster() {
  const [known,managed] = await Promise.all([listKnownUsers(),listManagedAccessUsers()])
  const emails = new Set([...known,...managed,...getConfiguredAccessUsers()].map(user=>user.email))
  const users = await Promise.all([...emails].map(async email=>({email,role:await getEffectiveUserRole(email)})))
  return users.filter(user=>user.role === "employee" || user.role === "user").sort((a,b)=>a.email.localeCompare(b.email))
}
/**
 * Creates message storage and its recipient/date index without changing records.
 * @returns Promise<void> when the idempotent schema statements complete.
 */
async function ensureMessages(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS app_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sender_email TEXT NOT NULL,
    recipient_email TEXT, body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  await sql`CREATE INDEX IF NOT EXISTS app_messages_recipient_date_idx ON app_messages (recipient_email,created_at DESC)`
}
/**
 * Lists private received/sent messages and permitted employee broadcasts.
 * @param email - Current authenticated identity.
 * @param receivesBroadcast - Whether the current role receives employee broadcasts.
 * @returns Promise of at most 100 recent authorized messages.
 */
export async function listMessages(email:string,receivesBroadcast:boolean) {
  await ensureMessages()
  return sql`SELECT id,sender_email,recipient_email,body,created_at FROM app_messages
    WHERE recipient_email = ${email.toLowerCase()} OR sender_email = ${email.toLowerCase()}
      OR (recipient_email IS NULL AND ${receivesBroadcast}) ORDER BY created_at DESC LIMIT 100`
}
/**
 * Saves a manager-authored private message or employee broadcast.
 * @param sender - Authenticated sender email.
 * @param recipient - Validated employee email, or null for all employees.
 * @param body - Validated plain-text message.
 * @returns Promise containing the newly stored message ID.
 */
export async function sendMessage(sender:string,recipient:string|null,body:string) {
  await ensureMessages()
  const rows = await sql`INSERT INTO app_messages (sender_email,recipient_email,body)
    VALUES (${sender.toLowerCase()},${recipient?.toLowerCase() ?? null},${body}) RETURNING id`
  return rows[0].id as string
}
