/** Admin-only inventory and controls for organizer-scoped Teams transcript capture. */
import { auth } from "@/auth"
import { getAuditContext } from "@/lib/audit"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { recordAuditEvent } from "@/lib/db"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listTeamsTranscriptSources, setTeamsTranscriptSourceEnabled } from "@/lib/teams-transcript-connections"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireAdmin() {
  const email = (await auth())?.user?.email?.trim().toLowerCase()
  if (!email) return { response: Response.json({ error: "Sign in as an administrator." }, { status: 401 }), email: null }
  const access = await getEffectivePermissions(email)
  if (access.role !== "admin") return { response: Response.json({ error: "Only administrators can manage transcript sources." }, { status: 403 }), email: null }
  return { response: null, email }
}

async function getSources() {
  const access = await requireAdmin()
  if (access.response) return access.response
  try {
    const sources = await listTeamsTranscriptSources()
    return Response.json({ sources: sources.map(source => ({
      ownerEmail: source.owner_email,
      connectedAccount: source.entra_email,
      connectedAt: source.connected_at,
      captureEnabled: source.capture_enabled,
      subscriptionActive: source.subscription_active === true,
      subscriptionExpiresAt: source.subscription_expires_at,
    })) }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Teams transcript sources are temporarily unavailable." }, { status: 503 })
  }
}

async function updateSource(request: Request) {
  const access = await requireAdmin()
  if (access.response) return access.response
  if (!access.email) return Response.json({ error: "Sign in as an administrator." }, { status: 401 })
  try {
    const input = z.object({ ownerEmail: z.string().trim().email().max(254), enabled: z.boolean() }).strict().parse(await request.json())
    const updated = await setTeamsTranscriptSourceEnabled(input.ownerEmail, input.enabled, access.email)
    if (!updated) return Response.json({ error: "That organizer account is no longer connected." }, { status: 404 })
    await recordAuditEvent({
      actorEmail: access.email,
      action: "teams_transcript_source_updated",
      targetType: "teams_transcript_source",
      targetId: updated.owner_email,
      metadata: { captureEnabled: updated.capture_enabled },
      ...getAuditContext(request),
    })
    return Response.json({ ownerEmail: updated.owner_email, captureEnabled: updated.capture_enabled, updatedAt: updated.updated_at }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Choose a connected organizer and a valid capture setting." }, { status: 400 })
    return Response.json({ error: "Unable to update the transcript source." }, { status: 503 })
  }
}

export const GET = withOperationalCapture("/api/admin/teams-transcript-sources", "GET", getSources)
export const PATCH = withOperationalCapture("/api/admin/teams-transcript-sources", "PATCH", updateSource)
