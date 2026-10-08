/**
 * Stores public messaging identities and encrypted recovery backups only.
 * A published identity is immutable to prevent silent replacement of recipients.
 * Private-key backups are exposed exclusively to their authenticated owner.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import type { KeyBackup, PublicMessageKey } from "@/lib/message-crypto"
const sql=neon(process.env.DATABASE_URL!)
let keySchema:Promise<void>|undefined
/** @returns Promise<void> once idempotent encrypted-key storage exists. */
async function ensureKeys():Promise<void>{
  await (keySchema??=sql`CREATE TABLE IF NOT EXISTS app_message_keys (email TEXT PRIMARY KEY,public_key TEXT NOT NULL,signing_key TEXT NOT NULL,fingerprint TEXT NOT NULL,backup JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.then(()=>{}).catch(error=>{keySchema=undefined;throw error}))
}
/** @param email - Authenticated owner. @returns Own public identity and encrypted recovery backup, or null. */
export async function ownMessageKey(email:string):Promise<(PublicMessageKey&{backup:KeyBackup})|null>{
  await ensureKeys();const rows=await sql`SELECT email,public_key AS "publicKey",signing_key AS "signingKey",fingerprint,backup FROM app_message_keys WHERE email=${email.toLowerCase()}`
  return rows[0] as (PublicMessageKey&{backup:KeyBackup}) ?? null
}
/** @param emails - Authorized participant identities. @returns Public keys only, never recovery backups. */
export async function publicMessageKeys(emails:string[]):Promise<PublicMessageKey[]>{
  await ensureKeys();return await sql`SELECT email,public_key AS "publicKey",signing_key AS "signingKey",fingerprint FROM app_message_keys WHERE email=ANY(${emails.map(email=>email.toLowerCase())}::text[])` as PublicMessageKey[]
}
/** @param email - Authenticated owner. @param key - Validated public identity and encrypted backup. @returns Whether first-time registration succeeded. */
export async function registerMessageKey(email:string,key:Omit<PublicMessageKey,"email">&{backup:KeyBackup}):Promise<boolean>{
  await ensureKeys();const rows=await sql`INSERT INTO app_message_keys(email,public_key,signing_key,fingerprint,backup) VALUES(${email.toLowerCase()},${key.publicKey},${key.signingKey},${key.fingerprint},${JSON.stringify(key.backup)}::jsonb) ON CONFLICT DO NOTHING RETURNING email`
  return rows.length>0
}
