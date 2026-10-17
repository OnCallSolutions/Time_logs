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
import { ensureCompanyDirectory } from "./company-directory"
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
  await ensureCompanyDirectory()
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS assistant_usage(email text PRIMARY KEY,window_start timestamptz NOT NULL DEFAULT now(),calls integer NOT NULL DEFAULT 1)`
    await sql`CREATE TABLE IF NOT EXISTS assistant_executions(id uuid PRIMARY KEY,actor_email text NOT NULL,action_kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`
    await sql`CREATE TABLE IF NOT EXISTS assistant_usage_by_company(
      company_id uuid NOT NULL REFERENCES licensed_company(company_id), email text NOT NULL,
      window_start timestamptz NOT NULL DEFAULT now(), calls integer NOT NULL DEFAULT 1,
      PRIMARY KEY(company_id,email)
    )`
    await sql`CREATE TABLE IF NOT EXISTS assistant_action_claims_by_company(
      company_id uuid NOT NULL REFERENCES licensed_company(company_id), id uuid NOT NULL,
      actor_email text NOT NULL, action_kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(company_id,id)
    )`
    await sql`CREATE TABLE IF NOT EXISTS assistant_conversations(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES licensed_company(company_id),
      actor_email text NOT NULL, workspace_key text NOT NULL CHECK(length(workspace_key) BETWEEN 1 AND 100),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(company_id,actor_email,workspace_key)
    )`
    await sql`CREATE TABLE IF NOT EXISTS assistant_conversation_messages(
      id bigserial PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES licensed_company(company_id), actor_email text NOT NULL,
      role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL CHECK(length(content) BETWEEN 1 AND 6000),
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS assistant_conversation_messages_recent_idx ON assistant_conversation_messages(conversation_id,id DESC)`
    await sql`CREATE TABLE IF NOT EXISTS assistant_runs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES licensed_company(company_id),
      actor_email text NOT NULL, workspace_key text NOT NULL, model_id text NOT NULL,
      status text NOT NULL CHECK(status IN ('running','succeeded','failed')), request_chars integer NOT NULL DEFAULT 0,
      response_chars integer NOT NULL DEFAULT 0, proposals integer NOT NULL DEFAULT 0,
      duration_ms integer, error_code text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    )`
    await sql`CREATE INDEX IF NOT EXISTS assistant_runs_company_started_idx ON assistant_runs(company_id,started_at DESC)`
  })
}

/** @param actor - Authenticated account. @param workspace - Active workspace. @param model - Configured model identifier. @param requestChars - Prompt length only; prompt contents are never recorded. @returns Persisted run ID for safe operational analytics. */
export async function startAssistantRun(actor:string,workspace:string,model:string,requestChars:number):Promise<string>{
  await ensureAssistantStorage();const sql=neon(process.env.DATABASE_URL!)
  const rows=await sql`INSERT INTO assistant_runs(company_id,actor_email,workspace_key,model_id,request_chars)
    SELECT company_id,${actor.toLowerCase()},${workspace},${model.slice(0,120)},${Math.max(0,Math.min(100_000,Math.floor(requestChars)))} FROM licensed_company WHERE singleton=true RETURNING id`
  if(!rows[0]?.id)throw new Error("Assistant run tracking is unavailable.")
  return String(rows[0].id)
}

/** @param id - Run record. @param actor - Authenticated owner. @param result - Sanitized aggregate outcome, never prompt content. @returns Promise<void> after marking the company-scoped run complete. */
export async function finishAssistantRun(id:string,actor:string,result:{status:"succeeded"|"failed";durationMs:number;responseChars?:number;proposals?:number;errorCode?:string}):Promise<void>{
  await ensureAssistantStorage();const sql=neon(process.env.DATABASE_URL!)
  await sql`UPDATE assistant_runs run SET status=${result.status},duration_ms=${Math.max(0,Math.min(120_000,Math.floor(result.durationMs)))},
    response_chars=${Math.max(0,Math.min(100_000,Math.floor(result.responseChars??0)))},proposals=${Math.max(0,Math.min(5,Math.floor(result.proposals??0)))},
    error_code=${result.errorCode??null},completed_at=now() FROM licensed_company company
    WHERE run.company_id=company.company_id AND company.singleton=true AND run.id=${id} AND run.actor_email=${actor.toLowerCase()} AND run.status='running'`
}

/** @param limit - Bounded page size. @param before - Optional keyset cursor. @returns Sanitized company run metadata for an admin report. */
export async function listAssistantRuns(limit:number,before?:{startedAt:string;id:string}):Promise<Array<Record<string,unknown>>>{
  await ensureAssistantStorage();const sql=neon(process.env.DATABASE_URL!),pageSize=Math.max(1,Math.min(100,Math.floor(limit)))
  if(before)return await sql`SELECT run.id,run.actor_email,run.workspace_key,run.model_id,run.status,run.request_chars,run.response_chars,run.proposals,run.duration_ms,run.error_code,run.started_at,run.completed_at
    FROM assistant_runs run JOIN licensed_company company ON company.company_id=run.company_id AND company.singleton=true
    WHERE (run.started_at,run.id)<(${before.startedAt}::timestamptz,${before.id}::uuid)
    ORDER BY run.started_at DESC,run.id DESC LIMIT ${pageSize}`
  return await sql`SELECT run.id,run.actor_email,run.workspace_key,run.model_id,run.status,run.request_chars,run.response_chars,run.proposals,run.duration_ms,run.error_code,run.started_at,run.completed_at
    FROM assistant_runs run JOIN licensed_company company ON company.company_id=run.company_id AND company.singleton=true
    ORDER BY run.started_at DESC,run.id DESC LIMIT ${pageSize}`
}

/** @param actor - Authenticated account. @param workspace - Bounded workspace key. @returns Company- and actor-scoped conversation with its recent history. */
export async function getAssistantConversation(actor:string,workspace:string):Promise<{id:string;messages:Array<{role:"user"|"assistant";content:string}>}> {
  await ensureAssistantStorage();const sql=neon(process.env.DATABASE_URL!),email=actor.toLowerCase()
  const rows=await sql`INSERT INTO assistant_conversations(company_id,actor_email,workspace_key)
    SELECT company_id,${email},${workspace} FROM licensed_company WHERE singleton=true
    ON CONFLICT(company_id,actor_email,workspace_key) DO UPDATE SET updated_at=now() RETURNING id`
  if(!rows[0]?.id)throw new Error("Assistant conversation could not be initialized.")
  const id=String(rows[0].id)
  const messages=await sql`SELECT m.role,m.content FROM assistant_conversation_messages m
    JOIN assistant_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id AND c.actor_email=m.actor_email
    WHERE c.id=${id} AND c.actor_email=${email} AND c.workspace_key=${workspace}
    ORDER BY m.id DESC LIMIT 20`
  return {id,messages:messages.reverse().map(row=>({role:row.role as "user"|"assistant",content:String(row.content)}))}
}

/** @param id - Conversation identifier. @param actor - Authenticated owner. @param workspace - Current workspace. @param role - Persisted message role. @param content - Bounded conversation content. @returns Promise<void> after company/owner-checked storage and bounded rolling history. */
export async function saveAssistantMessage(id:string,actor:string,workspace:string,role:"user"|"assistant",content:string):Promise<void> {
  await ensureAssistantStorage();const sql=neon(process.env.DATABASE_URL!),email=actor.toLowerCase()
  await sql`INSERT INTO assistant_conversation_messages(conversation_id,company_id,actor_email,role,content)
    SELECT c.id,c.company_id,c.actor_email,${role},${content} FROM assistant_conversations c
    JOIN licensed_company company ON company.company_id=c.company_id AND company.singleton=true
    WHERE c.id=${id} AND c.actor_email=${email} AND c.workspace_key=${workspace}`
  await sql`DELETE FROM assistant_conversation_messages WHERE id IN (
    SELECT m.id FROM assistant_conversation_messages m JOIN assistant_conversations c ON c.id=m.conversation_id
    WHERE c.id=${id} AND c.actor_email=${email} AND c.workspace_key=${workspace}
    ORDER BY m.id DESC OFFSET 20)`
  await sql`UPDATE assistant_conversations c SET updated_at=now() FROM licensed_company company
    WHERE c.company_id=company.company_id AND company.singleton=true AND c.id=${id} AND c.actor_email=${email} AND c.workspace_key=${workspace}`
}
/** @param email - Authenticated actor. @returns Promise<boolean> allowing at most ten requests per minute across instances. */
export async function allowAssistantRequest(email: string): Promise<boolean> {
  await ensureAssistantStorage(); const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`INSERT INTO assistant_usage_by_company(company_id,email)
    SELECT company_id,${email.toLowerCase()} FROM licensed_company WHERE singleton=true
    ON CONFLICT(company_id,email) DO UPDATE SET calls=CASE WHEN assistant_usage_by_company.window_start < now()-interval '1 minute' THEN 1 ELSE assistant_usage_by_company.calls+1 END,
    window_start=CASE WHEN assistant_usage_by_company.window_start < now()-interval '1 minute' THEN now() ELSE assistant_usage_by_company.window_start END
    WHERE assistant_usage_by_company.window_start < now()-interval '1 minute' OR assistant_usage_by_company.calls<10 RETURNING email`
  return rows.length === 1
}
/** @param id - Verified nonce. @param actor - Authenticated email. @param kind - Validated action kind. @returns Promise<boolean> granting only the first execution attempt. */
export async function claimAssistantAction(id: string, actor: string, kind: string): Promise<boolean> {
  await ensureAssistantStorage(); const sql = neon(process.env.DATABASE_URL!)
  const rows = await sql`INSERT INTO assistant_action_claims_by_company(company_id,id,actor_email,action_kind)
    SELECT company_id,${id},${actor.toLowerCase()},${kind} FROM licensed_company WHERE singleton=true
    ON CONFLICT(company_id,id) DO NOTHING RETURNING id`
  return rows.length === 1
}
