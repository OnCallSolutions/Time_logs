import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import { hashTeamsClientState, matchesTeamsClientState, teamsResourceMatchesOrganizer } from "@/lib/teams-transcript-notifications"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)
const initialize = createDatabaseInitializer()

export type TeamsTranscriptJob = {
  id: string
  ownerEmail: string
  entraTenantId: string
  organizerUserId: string
  subscriptionId: string
  providerResource: string
  providerTranscriptId: string | null
  status: "notification_received" | "fetch_queued" | "fetching" | "transcript_saved" | "failed_final"
  receivedAt: string
}

type TranscriptJobRow = {
  id: string
  owner_email: string
  entra_tenant_id: string
  organizer_user_id: string
  subscription_id: string
  provider_resource: string
  provider_transcript_id: string | null
  status: TeamsTranscriptJob["status"]
  received_at: string | Date
}

export async function ensureTeamsTranscriptInbox() {
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_subscriptions (
      subscription_id uuid PRIMARY KEY,
      owner_email text NOT NULL,
      entra_tenant_id uuid NOT NULL,
      organizer_user_id uuid NOT NULL,
      client_state_hash char(64) NOT NULL,
      resource text NOT NULL,
      expires_at timestamptz NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_subscriptions_owner_idx
      ON teams_transcript_subscriptions (lower(owner_email), active, expires_at)`
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_source_settings (
      owner_email text PRIMARY KEY,
      capture_enabled boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email text NOT NULL,
      entra_tenant_id uuid NOT NULL,
      organizer_user_id uuid NOT NULL,
      subscription_id uuid NOT NULL REFERENCES teams_transcript_subscriptions(subscription_id),
      provider_resource text NOT NULL,
      provider_transcript_id text,
      status text NOT NULL DEFAULT 'notification_received',
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      last_error_code text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      received_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (subscription_id, provider_resource)
    )`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_jobs_owner_idx
      ON teams_transcript_jobs (lower(owner_email), received_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_jobs_status_idx
      ON teams_transcript_jobs (status, available_at, received_at)`
    await sql`ALTER TABLE teams_transcript_jobs
      ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS last_error_code text,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_artifacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email text NOT NULL,
      entra_tenant_id uuid NOT NULL,
      organizer_user_id uuid NOT NULL,
      meeting_id text NOT NULL,
      transcript_id text NOT NULL,
      source_job_id uuid NOT NULL UNIQUE REFERENCES teams_transcript_jobs(id),
      content_ciphertext text NOT NULL,
      content_type text NOT NULL,
      content_sha256 char(64) NOT NULL,
      speaker_attribution_ciphertext text,
      attribution_status text NOT NULL DEFAULT 'pending',
      attribution_error_code text,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      UNIQUE (entra_tenant_id, organizer_user_id, transcript_id)
    )`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_artifacts_owner_expiry_idx
      ON teams_transcript_artifacts (lower(owner_email), expires_at)`
    await sql`ALTER TABLE teams_transcript_artifacts
      ADD COLUMN IF NOT EXISTS speaker_attribution_ciphertext text,
      ADD COLUMN IF NOT EXISTS attribution_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS attribution_error_code text`
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_job_id uuid NOT NULL REFERENCES teams_transcript_jobs(id) ON DELETE CASCADE,
      owner_email text NOT NULL,
      meeting_date date NOT NULL,
      entries_ciphertext text NOT NULL,
      entry_count integer NOT NULL,
      status text NOT NULL DEFAULT 'needs_review',
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_job_id, owner_email)
    )`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_drafts_owner_status_idx
      ON teams_transcript_drafts (lower(owner_email), status, created_at DESC)`
    await sql`ALTER TABLE teams_transcript_drafts
      ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')`
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_extraction_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_job_id uuid NOT NULL REFERENCES teams_transcript_jobs(id) ON DELETE CASCADE,
      owner_email text NOT NULL,
      meeting_date date NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      last_error_code text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_job_id, owner_email)
    )`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_extraction_jobs_queue_idx
      ON teams_transcript_extraction_jobs (status, available_at, created_at)`
    await sql`CREATE INDEX IF NOT EXISTS teams_transcript_extraction_jobs_owner_idx
      ON teams_transcript_extraction_jobs (lower(owner_email), status, created_at DESC)`
  })
}

function mapJob(row: TranscriptJobRow): TeamsTranscriptJob {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    entraTenantId: row.entra_tenant_id,
    organizerUserId: row.organizer_user_id,
    subscriptionId: row.subscription_id,
    providerResource: row.provider_resource,
    providerTranscriptId: row.provider_transcript_id,
    status: row.status,
    receivedAt: new Date(row.received_at).toISOString(),
  }
}

export async function saveTeamsTranscriptSubscription(input: {
  subscriptionId: string
  ownerEmail: string
  entraTenantId: string
  organizerUserId: string
  clientState: string
  resource: string
  expiresAt: string
}) {
  await ensureTeamsTranscriptInbox()
  await sql`UPDATE teams_transcript_subscriptions SET active=false,updated_at=now()
    WHERE lower(owner_email)=${input.ownerEmail.toLowerCase()} AND active=true
      AND (subscription_id<>${input.subscriptionId}::uuid OR entra_tenant_id<>${input.entraTenantId}::uuid OR organizer_user_id<>${input.organizerUserId}::uuid)`
  await sql`INSERT INTO teams_transcript_subscriptions (
      subscription_id, owner_email, entra_tenant_id, organizer_user_id,
      client_state_hash, resource, expires_at, active
    ) VALUES (
      ${input.subscriptionId}::uuid, ${input.ownerEmail.toLowerCase()}, ${input.entraTenantId}::uuid,
      ${input.organizerUserId}::uuid, ${hashTeamsClientState(input.clientState)}, ${input.resource},
      ${input.expiresAt}::timestamptz, true
    ) ON CONFLICT (subscription_id) DO UPDATE SET
      owner_email = EXCLUDED.owner_email,
      entra_tenant_id = EXCLUDED.entra_tenant_id,
      organizer_user_id = EXCLUDED.organizer_user_id,
      client_state_hash = EXCLUDED.client_state_hash,
      resource = EXCLUDED.resource,
      expires_at = EXCLUDED.expires_at,
      active = true,
      updated_at = now()`
}

export async function listTeamsTranscriptSubscriptionsForRenewal(limit = 50) {
  await ensureTeamsTranscriptInbox()
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100)
  return await sql`SELECT subscription.subscription_id::text AS subscription_id,
      subscription.owner_email,subscription.entra_tenant_id::text AS entra_tenant_id,
      subscription.organizer_user_id::text AS organizer_user_id,subscription.expires_at::text AS expires_at
    FROM teams_transcript_subscriptions subscription
    JOIN teams_transcript_connections connection ON lower(connection.owner_email)=lower(subscription.owner_email)
      AND connection.entra_tenant_id=subscription.entra_tenant_id
      AND connection.entra_user_id=subscription.organizer_user_id AND connection.disconnected_at IS NULL
    WHERE subscription.active=true AND subscription.expires_at<now()+interval '20 minutes'
    ORDER BY subscription.expires_at ASC LIMIT ${bounded}` as Array<{
      subscription_id: string
      owner_email: string
      entra_tenant_id: string
      organizer_user_id: string
      expires_at: string
    }>
}

export async function updateTeamsTranscriptSubscriptionExpiry(subscriptionId: string, expiresAt: string) {
  await ensureTeamsTranscriptInbox()
  await sql`UPDATE teams_transcript_subscriptions SET expires_at=${expiresAt}::timestamptz,updated_at=now()
    WHERE subscription_id=${subscriptionId}::uuid AND active=true`
}

export async function enqueueTeamsTranscriptNotification(input: {
  subscriptionId: string
  clientState: string
  resource: string
  providerTranscriptId: string | null
  tenantId: string | null
}) {
  await ensureTeamsTranscriptInbox()
  const subscriptions = await sql`SELECT subscription.subscription_id, subscription.owner_email, subscription.entra_tenant_id, subscription.organizer_user_id,
      subscription.client_state_hash, subscription.resource, subscription.expires_at,
      COALESCE(source.capture_enabled, true) AS capture_enabled
    FROM teams_transcript_subscriptions subscription
    LEFT JOIN teams_transcript_source_settings source ON lower(source.owner_email) = lower(subscription.owner_email)
    WHERE subscription.subscription_id = ${input.subscriptionId}::uuid AND subscription.active = true AND subscription.expires_at > now()
    LIMIT 1`
  const subscription = subscriptions[0] as {
    subscription_id: string
    owner_email: string
    entra_tenant_id: string
    organizer_user_id: string
    client_state_hash: string
    resource: string
    capture_enabled: boolean
  } | undefined
  if (!subscription || !subscription.capture_enabled || !matchesTeamsClientState(input.clientState, subscription.client_state_hash)) return false
  if (input.tenantId && input.tenantId.toLowerCase() !== subscription.entra_tenant_id.toLowerCase()) return false
  if (!teamsResourceMatchesOrganizer(subscription.resource, input.resource)) return false

  await sql`INSERT INTO teams_transcript_jobs (
      owner_email, entra_tenant_id, organizer_user_id, subscription_id,
      provider_resource, provider_transcript_id, status
    ) VALUES (
      ${subscription.owner_email}, ${subscription.entra_tenant_id}::uuid, ${subscription.organizer_user_id}::uuid,
      ${subscription.subscription_id}::uuid, ${input.resource}, ${input.providerTranscriptId}, 'fetch_queued'
    ) ON CONFLICT (subscription_id, provider_resource) DO NOTHING`
  return true
}

/** Enqueues already-existing transcripts while preserving the normal source and dedupe rules. */
export async function enqueueTeamsTranscriptBackfill(input: {
  ownerEmail: string
  organizerUserId: string
  transcripts: Array<{ resource: string; transcriptId: string; createdAt: string }>
}) {
  await ensureTeamsTranscriptInbox()
  const candidates = input.transcripts.slice(0, 1000)
  if (!candidates.length) return { queued: 0, duplicates: 0 }
  const rows = await sql`WITH source AS (
      SELECT subscription.subscription_id, subscription.owner_email, subscription.entra_tenant_id, subscription.organizer_user_id
      FROM teams_transcript_subscriptions subscription
      JOIN teams_transcript_connections connection ON lower(connection.owner_email)=lower(subscription.owner_email)
        AND connection.disconnected_at IS NULL
        AND connection.entra_tenant_id=subscription.entra_tenant_id
        AND connection.entra_user_id=subscription.organizer_user_id
      LEFT JOIN teams_transcript_source_settings setting ON lower(setting.owner_email)=lower(subscription.owner_email)
      WHERE lower(subscription.owner_email)=${input.ownerEmail.toLowerCase()}
        AND lower(subscription.organizer_user_id::text)=${input.organizerUserId.toLowerCase()}
        AND COALESCE(setting.capture_enabled,true)=true
      ORDER BY subscription.created_at DESC LIMIT 1
    ), requested AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
        AS item(resource text, "transcriptId" text, "createdAt" timestamptz)
    ), inserted AS (
      INSERT INTO teams_transcript_jobs (
        owner_email,entra_tenant_id,organizer_user_id,subscription_id,provider_resource,provider_transcript_id,status,received_at
      )
      SELECT source.owner_email,source.entra_tenant_id,source.organizer_user_id,source.subscription_id,
        requested.resource,requested."transcriptId",'fetch_queued',requested."createdAt"
      FROM source CROSS JOIN requested
      ON CONFLICT (subscription_id,provider_resource) DO UPDATE SET
        status='fetch_queued',attempts=0,available_at=now(),last_error_code=NULL,updated_at=now()
      WHERE teams_transcript_jobs.status='failed_final'
      RETURNING id
    ) SELECT count(*)::int AS queued FROM inserted` as Array<{ queued: number }>
  const queued = Number(rows[0]?.queued ?? 0)
  return { queued, duplicates: candidates.length - queued }
}

export async function listQueuedTeamsTranscriptJobs(limit = 50) {
  await ensureTeamsTranscriptInbox()
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100)
  const rows = await sql`SELECT id, owner_email, entra_tenant_id, organizer_user_id, subscription_id,
      provider_resource, provider_transcript_id, status, received_at
    FROM teams_transcript_jobs
    WHERE status = 'fetch_queued' AND available_at <= now()
    ORDER BY received_at ASC
    LIMIT ${bounded}` as TranscriptJobRow[]
  return rows.map(mapJob)
}

export async function claimTeamsTranscriptJob() {
  await ensureTeamsTranscriptInbox()
  const rows = await sql`WITH candidate AS (
      SELECT id FROM teams_transcript_jobs
      WHERE status = 'fetch_queued' AND available_at <= now()
      ORDER BY received_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE teams_transcript_jobs job SET status='fetching', attempts=attempts+1, updated_at=now()
    FROM candidate WHERE job.id=candidate.id
    RETURNING job.id,job.owner_email,job.entra_tenant_id,job.organizer_user_id,job.subscription_id,
      job.provider_resource,job.provider_transcript_id,job.status,job.received_at` as TranscriptJobRow[]
  return rows[0] ? mapJob(rows[0]) : null
}

export async function saveFetchedTeamsTranscript(input: {
  job: TeamsTranscriptJob
  meetingId: string
  transcriptId: string
  encryptedContent: string
  contentType: string
  contentSha256: string
  encryptedSpeakerAttribution: string | null
  attributionStatus: "resolved" | "unresolved" | "unavailable"
  attributionErrorCode: string | null
  retentionDays?: number
}) {
  await ensureTeamsTranscriptInbox()
  const retentionDays = Math.min(Math.max(Math.trunc(input.retentionDays ?? 30), 1), 90)
  await sql.transaction([
    sql`INSERT INTO teams_transcript_artifacts (
        owner_email,entra_tenant_id,organizer_user_id,meeting_id,transcript_id,source_job_id,
        content_ciphertext,content_type,content_sha256,speaker_attribution_ciphertext,
        attribution_status,attribution_error_code,expires_at
      ) VALUES (
        ${input.job.ownerEmail.toLowerCase()},${input.job.entraTenantId}::uuid,${input.job.organizerUserId}::uuid,
        ${input.meetingId},${input.transcriptId},${input.job.id}::uuid,${input.encryptedContent},
        ${input.contentType},${input.contentSha256},${input.encryptedSpeakerAttribution},
        ${input.attributionStatus},${input.attributionErrorCode},now()+(${retentionDays} * interval '1 day')
      ) ON CONFLICT (entra_tenant_id,organizer_user_id,transcript_id) DO UPDATE SET
        speaker_attribution_ciphertext=COALESCE(teams_transcript_artifacts.speaker_attribution_ciphertext,EXCLUDED.speaker_attribution_ciphertext),
        attribution_status=CASE WHEN teams_transcript_artifacts.attribution_status='unavailable' AND EXCLUDED.attribution_status<>'unavailable' THEN EXCLUDED.attribution_status ELSE teams_transcript_artifacts.attribution_status END,
        attribution_error_code=CASE WHEN EXCLUDED.attribution_status<>'unavailable' THEN NULL ELSE teams_transcript_artifacts.attribution_error_code END`,
    sql`UPDATE teams_transcript_jobs SET status='transcript_saved',last_error_code=NULL,updated_at=now()
      WHERE id=${input.job.id}::uuid AND status='fetching'`,
  ])
}

export async function failTeamsTranscriptJob(job: TeamsTranscriptJob, errorCode: string) {
  await ensureTeamsTranscriptInbox()
  const code = /^[A-Z0-9_.-]{1,80}$/.test(errorCode) ? errorCode : "UPSTREAM_FAILURE"
  const rows = await sql`UPDATE teams_transcript_jobs SET
      status=CASE WHEN attempts >= 5 THEN 'failed_final' ELSE 'fetch_queued' END,
      available_at=now()+make_interval(mins => LEAST(power(2,attempts)::int,60)),
      last_error_code=${code},updated_at=now()
    WHERE id=${job.id}::uuid AND status='fetching'
    RETURNING status`
  return rows[0]?.status === "failed_final"
}

export async function deleteExpiredTeamsTranscriptArtifacts() {
  await ensureTeamsTranscriptInbox()
  await sql`DELETE FROM teams_transcript_drafts WHERE expires_at <= now()`
  const rows = await sql`DELETE FROM teams_transcript_artifacts WHERE expires_at <= now() RETURNING id`
  return rows.length
}

export async function saveTeamsTranscriptDraft(input: {
  sourceJobId: string
  ownerEmail: string
  meetingDate: string
  encryptedEntries: string
  entryCount: number
}) {
  await ensureTeamsTranscriptInbox()
  await sql`INSERT INTO teams_transcript_drafts (
      source_job_id, owner_email, meeting_date, entries_ciphertext, entry_count
    ) VALUES (
      ${input.sourceJobId}::uuid, ${input.ownerEmail.toLowerCase()}, ${input.meetingDate}::date,
      ${input.encryptedEntries}, ${input.entryCount}
    ) ON CONFLICT (source_job_id, owner_email) DO NOTHING`
}

export async function listTeamsTranscriptDrafts(ownerEmail: string) {
  await ensureTeamsTranscriptInbox()
  return await sql`SELECT id, meeting_date::text AS meeting_date, entries_ciphertext, entry_count, created_at::text AS created_at
    FROM teams_transcript_drafts
    WHERE lower(owner_email) = ${ownerEmail.toLowerCase()} AND status = 'needs_review' AND expires_at > now()
    ORDER BY created_at DESC LIMIT 50` as Array<{
      id: string
      meeting_date: string
      entries_ciphertext: string
      entry_count: number
      created_at: string
    }>
}

export async function updateTeamsTranscriptDraftStatus(id: string, ownerEmail: string, status: "saved" | "dismissed") {
  await ensureTeamsTranscriptInbox()
  const rows = await sql`UPDATE teams_transcript_drafts SET status = ${status}, updated_at = now()
    WHERE id = ${id}::uuid AND lower(owner_email) = ${ownerEmail.toLowerCase()} AND status = 'needs_review'
    RETURNING id`
  return rows.length > 0
}

export type TeamsTranscriptExtractionJob = { id: string; sourceJobId: string; ownerEmail: string; meetingDate: string; attempts: number }

export async function enqueueTeamsTranscriptExtraction(input: { sourceJobId: string; ownerEmail: string; meetingDate: string }) {
  await ensureTeamsTranscriptInbox()
  await sql`INSERT INTO teams_transcript_extraction_jobs (source_job_id, owner_email, meeting_date)
    VALUES (${input.sourceJobId}::uuid, ${input.ownerEmail.toLowerCase()}, ${input.meetingDate}::date)
    ON CONFLICT (source_job_id, owner_email) DO NOTHING`
}

export async function claimTeamsTranscriptExtractionJob(): Promise<TeamsTranscriptExtractionJob | null> {
  await ensureTeamsTranscriptInbox()
  const rows = await sql`WITH candidate AS (
      SELECT id FROM teams_transcript_extraction_jobs
      WHERE status = 'queued' AND available_at <= now()
      ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE teams_transcript_extraction_jobs job
      SET status = 'processing', attempts = attempts + 1, updated_at = now()
      FROM candidate WHERE job.id = candidate.id
      RETURNING job.id,job.source_job_id,job.owner_email,job.meeting_date::text AS meeting_date,job.attempts`
  const row = rows[0] as { id: string; source_job_id: string; owner_email: string; meeting_date: string; attempts: number } | undefined
  return row ? { id: row.id, sourceJobId: row.source_job_id, ownerEmail: row.owner_email, meetingDate: row.meeting_date, attempts: Number(row.attempts) } : null
}

export async function getTeamsTranscriptArtifactForExtraction(sourceJobId: string) {
  await ensureTeamsTranscriptInbox()
  const rows = await sql`SELECT content_ciphertext, speaker_attribution_ciphertext
    FROM teams_transcript_artifacts WHERE source_job_id = ${sourceJobId}::uuid AND expires_at > now() LIMIT 1`
  return rows[0] as { content_ciphertext: string; speaker_attribution_ciphertext: string | null } | undefined
}

export async function completeTeamsTranscriptExtraction(id: string) {
  await ensureTeamsTranscriptInbox()
  await sql`UPDATE teams_transcript_extraction_jobs SET status='completed',last_error_code=NULL,updated_at=now()
    WHERE id=${id}::uuid AND status='processing'`
}

export async function failTeamsTranscriptExtraction(job: TeamsTranscriptExtractionJob, errorCode: string) {
  await ensureTeamsTranscriptInbox()
  const code = /^[A-Z0-9_.-]{1,80}$/.test(errorCode) ? errorCode : "AI_EXTRACTION_FAILED"
  const rows = await sql`UPDATE teams_transcript_extraction_jobs SET
      status=CASE WHEN attempts >= 5 THEN 'failed_final' ELSE 'queued' END,
      available_at=now()+make_interval(mins => LEAST(power(2,attempts)::int,60)),
      last_error_code=${code},updated_at=now()
    WHERE id=${job.id}::uuid AND status='processing'
    RETURNING status`
  return rows[0]?.status === "failed_final"
}

export async function listTeamsTranscriptExtractionStatus(ownerEmail: string) {
  await ensureTeamsTranscriptInbox()
  return await sql`SELECT job.id,job.meeting_date::text AS meeting_date,job.status,job.last_error_code,job.attempts
    FROM teams_transcript_extraction_jobs job
    JOIN teams_transcript_jobs source ON source.id=job.source_job_id
    WHERE lower(job.owner_email)=${ownerEmail.toLowerCase()} AND source.received_at > now()-interval '30 days'
      AND job.status IN ('queued','processing','failed_final')
    ORDER BY job.created_at DESC LIMIT 50` as Array<{id:string;meeting_date:string;status:string;last_error_code:string|null;attempts:number}>
}

export async function retryTeamsTranscriptExtraction(id: string, ownerEmail: string) {
  await ensureTeamsTranscriptInbox()
  const rows = await sql`UPDATE teams_transcript_extraction_jobs SET status='queued',attempts=0,available_at=now(),last_error_code=NULL,updated_at=now()
    WHERE id=${id}::uuid AND lower(owner_email)=${ownerEmail.toLowerCase()} AND status='failed_final'
    RETURNING id`
  return rows.length > 0
}
