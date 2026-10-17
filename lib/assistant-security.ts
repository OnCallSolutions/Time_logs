/**
 * Enforces same-origin bounded requests and actor/session-bound action confirmation.
 * Signed proposals expire after five minutes; storage claims prevent duplicate execution.
 * SQL values are parameters and no prompt or plaintext message is stored here.
 */
import "server-only"
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { z } from "zod"
import { createDatabaseInitializer } from "./database-initializer"
import { assistantActionSchema, type AssistantAction } from "./assistant-contract"
const initialize = createDatabaseInitializer()
const tokenSchema = z.object({ id: z.string().uuid(), actor: z.string().email(), session: z.string().min(1), expires: z.number(), action: assistantActionSchema }).strict()

/** @returns Server-only signing material; a missing secret disables actions. */
function secret(): string {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error("Assistant signing is unavailable.")
  return value
}
/** @param payload - Encoded bounded proposal. @returns HMAC bytes authenticating all fields. */
function signature(payload: string): Buffer { return createHmac("sha256", secret()).update(payload).digest() }

/** @param actor - Signed-in email. @param session - Server session ID. @param action - Validated proposal. @returns Expiring signed token. */
export function signAssistantAction(actor: string, session: string, action: AssistantAction): string {
  const payload = Buffer.from(JSON.stringify({ id: randomUUID(), actor: actor.toLowerCase(), session, expires: Date.now() + 300_000, action })).toString("base64url")
  return `${payload}.${signature(payload).toString("base64url")}`
}
/** @param token - Untrusted confirmation. @param actor - Current email. @param session - Current session ID. @returns Verified proposal or throws before any side effect. */
export function verifyAssistantAction(token: string, actor: string, session: string) {
  if (token.length > 100_000) throw new Error("Invalid action.")
  const parts = token.split(".")
  if (parts.length !== 2) throw new Error("Invalid action.")
  const expected = signature(parts[0]), actual = Buffer.from(parts[1], "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid action.")
  const value = tokenSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")))
  if (value.actor !== actor.toLowerCase() || value.session !== session || value.expires <= Date.now() || value.expires > Date.now() + 300_000) throw new Error("Action expired or belongs to another session.")
  return value
}
/**
 * Reads a strictly same-origin JSON body without trusting Content-Length.
 * @param request - Browser request with a verified origin and JSON media type.
 * @param limit - Maximum body bytes allowed in memory.
 * @returns Promise<unknown> parsed JSON; throws on cross-site, oversized or malformed data.
 */
export async function readAssistantRequest(request: Request, limit = 48_000): Promise<unknown> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Invalid request origin.")
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("JSON is required.")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("Request body is required.")
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel(); throw new Error("Request is too large.") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
/** @returns Promise<void> after durable limits and one-use execution storage exist. */
async function ensureAssistantStorage(): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!)
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS assistant_usage(email text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),calls integer NOT NULL DEFAULT 1)`
    await sql`CREATE TABLE IF NOT EXISTS assistant_executions(id uuid PRIMARY KEY,actor_email text NOT NULL,action_kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`
  })
}
/** @param email - Authenticated actor. @returns Promise<boolean> allowing at most ten requests per minute across instances. */
export async function allowAssistantRequest(email: string): Promise<boolean> {
  await ensureAssistantStorage(); const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`INSERT INTO assistant_usage(email) VALUES(${email.toLowerCase()})
    ON CONFLICT(email) DO UPDATE SET calls=CASE WHEN assistant_usage.window_start < now()-interval '1 minute' THEN 1 ELSE assistant_usage.calls+1 END,
    window_start=CASE WHEN assistant_usage.window_start < now()-interval '1 minute' THEN now() ELSE assistant_usage.window_start END
    WHERE assistant_usage.window_start < now()-interval '1 minute' OR assistant_usage.calls<10 RETURNING email`
  return rows.length === 1
}
/** @param id - Verified nonce. @param actor - Authenticated email. @param kind - Validated action kind. @returns Promise<boolean> granting only the first execution attempt. */
export async function claimAssistantAction(id: string, actor: string, kind: string): Promise<boolean> {
  await ensureAssistantStorage(); const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`INSERT INTO assistant_executions(id,actor_email,action_kind) VALUES(${id},${actor},${kind}) ON CONFLICT(id) DO NOTHING RETURNING id`
  return rows.length === 1
}
