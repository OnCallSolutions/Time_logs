import "server-only"
import { neon } from "@neondatabase/serverless"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import { ensureTeamsTranscriptInbox } from "@/lib/teams-transcript-inbox"
import { decryptTeamsTokenCache, encryptTeamsTokenCache } from "@/lib/teams-transcript-connection-crypto"
import { teamsConfidentialClient, TEAMS_GRAPH_SCOPES } from "@/lib/teams-transcript-msal"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)
const initialize = createDatabaseInitializer()

async function ensureConnections() {
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS teams_transcript_connections (
      owner_email text PRIMARY KEY,
      entra_tenant_id uuid NOT NULL,
      entra_user_id uuid NOT NULL,
      entra_email text NOT NULL,
      msal_cache_ciphertext text NOT NULL,
      scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
      connected_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      disconnected_at timestamptz
    )`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS teams_transcript_connections_entra_user_idx
      ON teams_transcript_connections (entra_tenant_id, entra_user_id)
      WHERE disconnected_at IS NULL`
  })
}

export async function saveTeamsTranscriptConnection(input: {
  ownerEmail: string
  entraTenantId: string
  entraUserId: string
  entraEmail: string
  encryptedCache: string
  scopes: string[]
}) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  await sql`UPDATE teams_transcript_subscriptions SET active = false, updated_at = now()
    WHERE lower(owner_email) = ${input.ownerEmail.toLowerCase()} AND active = true
      AND (entra_tenant_id <> ${input.entraTenantId}::uuid OR organizer_user_id <> ${input.entraUserId}::uuid)`
  await sql`INSERT INTO teams_transcript_connections (
      owner_email, entra_tenant_id, entra_user_id, entra_email,
      msal_cache_ciphertext, scopes, disconnected_at
    ) VALUES (
      ${input.ownerEmail.toLowerCase()}, ${input.entraTenantId}::uuid, ${input.entraUserId}::uuid,
      ${input.entraEmail.toLowerCase()}, ${input.encryptedCache}, ${JSON.stringify(input.scopes)}::jsonb, NULL
    ) ON CONFLICT (owner_email) DO UPDATE SET
      entra_tenant_id = EXCLUDED.entra_tenant_id,
      entra_user_id = EXCLUDED.entra_user_id,
      entra_email = EXCLUDED.entra_email,
      msal_cache_ciphertext = EXCLUDED.msal_cache_ciphertext,
      scopes = EXCLUDED.scopes,
      connected_at = now(),
      updated_at = now(),
      disconnected_at = NULL`
}

export async function disconnectTeamsTranscriptConnection(ownerEmail: string) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  await sql`UPDATE teams_transcript_connections SET disconnected_at = now(), updated_at = now(),
      msal_cache_ciphertext = '', scopes = '[]'::jsonb
    WHERE owner_email = ${ownerEmail.toLowerCase()} AND disconnected_at IS NULL`
  await sql`UPDATE teams_transcript_subscriptions SET active = false, updated_at = now()
    WHERE lower(owner_email) = ${ownerEmail.toLowerCase()}`
}

export async function getTeamsTranscriptConnectionStatus(ownerEmail: string) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  const rows = await sql`SELECT c.entra_email, c.connected_at, c.scopes, s.expires_at, s.active
    FROM teams_transcript_connections c
    LEFT JOIN teams_transcript_subscriptions s ON lower(s.owner_email) = lower(c.owner_email)
    WHERE lower(c.owner_email) = ${ownerEmail.toLowerCase()} AND c.disconnected_at IS NULL
    ORDER BY s.created_at DESC NULLS LAST LIMIT 1`
  const row = rows[0] as { entra_email: string; connected_at: string | Date; scopes: string[]; expires_at: string | Date | null; active: boolean | null } | undefined
  return row ? {
    connected: true,
    connectedAccount: row.entra_email,
    connectedAt: new Date(row.connected_at).toISOString(),
    attendeeIdentityEnabled: hasGraphScope(row.scopes, "OnlineMeetingArtifact.Read.All"),
    subscriptionActive: row.active === true && row.expires_at !== null && new Date(row.expires_at).getTime() > Date.now(),
    subscriptionExpiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  } : { connected: false, connectedAccount: null, connectedAt: null, attendeeIdentityEnabled: false, subscriptionActive: false, subscriptionExpiresAt: null }
}

/** Returns the verified organizer identity used for a patron-owned historical lookup. */
export async function getTeamsTranscriptOrganizer(ownerEmail: string) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  const rows = await sql`SELECT connection.entra_tenant_id::text AS entra_tenant_id,
      connection.entra_user_id::text AS entra_user_id,
      connection.entra_email,
      subscription.subscription_id::text AS subscription_id,
      COALESCE(source.capture_enabled,true) AS capture_enabled
    FROM teams_transcript_connections connection
    LEFT JOIN LATERAL (
      SELECT subscription_id FROM teams_transcript_subscriptions
      WHERE lower(owner_email)=lower(connection.owner_email)
        AND entra_tenant_id=connection.entra_tenant_id AND organizer_user_id=connection.entra_user_id
      ORDER BY created_at DESC LIMIT 1
    ) subscription ON true
    LEFT JOIN teams_transcript_source_settings source ON lower(source.owner_email)=lower(connection.owner_email)
    WHERE lower(connection.owner_email)=${ownerEmail.toLowerCase()} AND connection.disconnected_at IS NULL
    LIMIT 1`
  return rows[0] as { entra_tenant_id: string; entra_user_id: string; entra_email: string; subscription_id: string | null; capture_enabled: boolean } | undefined
}

/** Lists organizer accounts an administrator can enable as transcript sources. */
export async function listTeamsTranscriptSources() {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  return await sql`SELECT c.owner_email, c.entra_email, c.connected_at::text AS connected_at,
      COALESCE(settings.capture_enabled, true) AS capture_enabled,
      subscription.active AND subscription.expires_at > now() AS subscription_active,
      subscription.expires_at::text AS subscription_expires_at
    FROM teams_transcript_connections c
    LEFT JOIN teams_transcript_source_settings settings ON lower(settings.owner_email) = lower(c.owner_email)
    LEFT JOIN LATERAL (
      SELECT active, expires_at FROM teams_transcript_subscriptions s
      WHERE lower(s.owner_email) = lower(c.owner_email)
      ORDER BY s.created_at DESC LIMIT 1
    ) subscription ON true
    WHERE c.disconnected_at IS NULL
    ORDER BY lower(c.entra_email), lower(c.owner_email)` as Array<{
      owner_email: string
      entra_email: string
      connected_at: string
      capture_enabled: boolean
      subscription_active: boolean | null
      subscription_expires_at: string | null
    }>
}

/** Persists an admin's capture choice for one connected organizer account. */
export async function setTeamsTranscriptSourceEnabled(ownerEmail: string, enabled: boolean, updatedBy: string) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  const rows = await sql`INSERT INTO teams_transcript_source_settings (owner_email, capture_enabled, updated_by, updated_at)
    SELECT c.owner_email, ${enabled}, ${updatedBy.toLowerCase()}, now()
    FROM teams_transcript_connections c
    WHERE lower(c.owner_email) = ${ownerEmail.toLowerCase()} AND c.disconnected_at IS NULL
    ON CONFLICT (owner_email) DO UPDATE SET capture_enabled = EXCLUDED.capture_enabled,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING owner_email, capture_enabled, updated_at::text AS updated_at`
  return rows[0] as { owner_email: string; capture_enabled: boolean; updated_at: string } | undefined
}

/** Obtains a delegated Graph token from the encrypted server-side MSAL cache. */
export async function getTeamsTranscriptAccessToken(ownerEmail: string, expectedTenantId: string, expectedOrganizerId: string, includeAttendanceScope = false, allowPausedCapture = false) {
  await ensureConnections()
  await ensureTeamsTranscriptInbox()
  const rows = await sql`SELECT connection.entra_tenant_id,connection.entra_user_id,connection.msal_cache_ciphertext,connection.scopes,
      COALESCE(source.capture_enabled, true) AS capture_enabled
    FROM teams_transcript_connections connection
    LEFT JOIN teams_transcript_source_settings source ON lower(source.owner_email)=lower(connection.owner_email)
    WHERE lower(connection.owner_email)=${ownerEmail.toLowerCase()}
      AND connection.disconnected_at IS NULL LIMIT 1`
  const row = rows[0] as { entra_tenant_id: string; entra_user_id: string; msal_cache_ciphertext: string; scopes: string[]; capture_enabled: boolean } | undefined
  if (!row || row.entra_tenant_id.toLowerCase() !== expectedTenantId.toLowerCase() || row.entra_user_id.toLowerCase() !== expectedOrganizerId.toLowerCase()) {
    throw new Error("TEAMS_CONNECTION_NOT_AVAILABLE")
  }
  if (!row.capture_enabled && !allowPausedCapture) throw new Error("TEAMS_TRANSCRIPT_SOURCE_DISABLED")
  if (includeAttendanceScope && !hasGraphScope(row.scopes, "OnlineMeetingArtifact.Read.All")) throw new Error("TEAMS_ATTENDANCE_CONSENT_REQUIRED")

  const client = teamsConfidentialClient()
  await client.getTokenCache().deserialize(decryptTeamsTokenCache(row.msal_cache_ciphertext))
  const account = (await client.getTokenCache().getAllAccounts()).find(candidate => candidate.localAccountId.toLowerCase() === expectedOrganizerId.toLowerCase() && candidate.tenantId.toLowerCase() === expectedTenantId.toLowerCase())
  if (!account) throw new Error("TEAMS_REAUTHORIZATION_REQUIRED")
  const scopes = includeAttendanceScope ? TEAMS_GRAPH_SCOPES : TEAMS_GRAPH_SCOPES.filter(scope => scope !== "OnlineMeetingArtifact.Read.All")
  const result = await client.acquireTokenSilent({ account, scopes })
  if (result.tenantId.toLowerCase() !== expectedTenantId.toLowerCase()) throw new Error("TEAMS_TENANT_MISMATCH")
  await sql`UPDATE teams_transcript_connections SET msal_cache_ciphertext=${encryptTeamsTokenCache(client.getTokenCache().serialize())},updated_at=now()
    WHERE lower(owner_email)=${ownerEmail.toLowerCase()} AND disconnected_at IS NULL`
  return result.accessToken
}

function hasGraphScope(scopes: string[] | null, required: string) {
  return (scopes ?? []).some(scope => scope.toLowerCase().endsWith(`/${required.toLowerCase()}`) || scope.toLowerCase() === required.toLowerCase())
}
