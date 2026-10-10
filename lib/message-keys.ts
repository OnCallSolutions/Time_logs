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
  await (keySchema??=(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS app_message_keys (email TEXT PRIMARY KEY,public_key TEXT NOT NULL,signing_key TEXT NOT NULL,fingerprint TEXT NOT NULL,backup JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    await sql`CREATE TABLE IF NOT EXISTS app_message_devices (
      email TEXT NOT NULL,device_id UUID NOT NULL,slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
      public_key TEXT NOT NULL,signing_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(email,device_id),UNIQUE(email,slot),UNIQUE(email,fingerprint))`
  })().catch(error=>{keySchema=undefined;throw error}))
}
/** @param email - Authenticated owner. @returns Own public identity and encrypted recovery backup, or null. */
export async function ownMessageKey(email:string):Promise<(PublicMessageKey&{backup:KeyBackup})|null>{
  await ensureKeys();const rows=await sql`SELECT email,public_key AS "publicKey",signing_key AS "signingKey",fingerprint,backup FROM app_message_keys WHERE email=${email.toLowerCase()}`
  return rows[0] as (PublicMessageKey&{backup:KeyBackup}) ?? null
}
/** @param emails - Authorized participant identities. @returns Public keys only, never recovery backups. */
export async function publicMessageKeys(emails:string[]):Promise<PublicMessageKey[]>{
  await ensureKeys();return await sql`
    SELECT email,public_key AS "publicKey",signing_key AS "signingKey",fingerprint,NULL::text AS "deviceId" FROM app_message_keys WHERE email=ANY(${emails.map(email=>email.toLowerCase())}::text[])
    UNION ALL
    SELECT email,public_key AS "publicKey",signing_key AS "signingKey",fingerprint,device_id::text AS "deviceId" FROM app_message_devices WHERE email=ANY(${emails.map(email=>email.toLowerCase())}::text[])` as PublicMessageKey[]
}
/**
 * Registers an immutable browser device without accepting any private material.
 * Fixed owner slots bound enrollment to five devices and prevent concurrent overflow.
 * @param email - Authenticated account owner, never supplied by the request body.
 * @param key - Validated public keys and browser-generated device identifier.
 * @returns True for enrollment or an identical idempotent retry; false at the limit.
 */
export async function registerMessageDevice(email:string,key:Omit<PublicMessageKey,"email">&{deviceId:string}):Promise<boolean>{
  await ensureKeys();const owner=email.toLowerCase()
  const existing=await sql`SELECT fingerprint FROM app_message_devices WHERE email=${owner} AND device_id=${key.deviceId}::uuid`
  if(existing.length)return existing[0].fingerprint===key.fingerprint
  const rows=await sql`INSERT INTO app_message_devices(email,device_id,slot,public_key,signing_key,fingerprint)
    SELECT ${owner},${key.deviceId}::uuid,available.slot,${key.publicKey},${key.signingKey},${key.fingerprint}
    FROM (SELECT slots.slot FROM generate_series(1,5) AS slots(slot) WHERE NOT EXISTS(
      SELECT 1 FROM app_message_devices WHERE email=${owner} AND app_message_devices.slot=slots.slot) ORDER BY slots.slot LIMIT 1) available
    ON CONFLICT DO NOTHING RETURNING device_id`
  if(rows.length)return true
  const retry=await sql`SELECT fingerprint FROM app_message_devices WHERE email=${owner} AND device_id=${key.deviceId}::uuid`
  return retry[0]?.fingerprint===key.fingerprint
}
/** @param email - Authenticated owner. @param key - Validated public identity and encrypted backup. @returns Whether first-time registration succeeded. */
export async function registerMessageKey(email:string,key:Omit<PublicMessageKey,"email">&{backup:KeyBackup}):Promise<boolean>{
  await ensureKeys();const rows=await sql`INSERT INTO app_message_keys(email,public_key,signing_key,fingerprint,backup) VALUES(${email.toLowerCase()},${key.publicKey},${key.signingKey},${key.fingerprint},${JSON.stringify(key.backup)}::jsonb) ON CONFLICT DO NOTHING RETURNING email`
  return rows.length>0
}
