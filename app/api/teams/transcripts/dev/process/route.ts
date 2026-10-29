/**
 * Local-development control for exercising the complete Teams-to-draft path.
 * This endpoint is intentionally unavailable in every non-development runtime;
 * deployed environments continue to use the separately authenticated cron routes.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { recordAuditEvent } from "@/lib/db"
import { processTeamsTranscriptExtractionQueue, processTeamsTranscriptQueue } from "@/lib/teams-transcript-worker"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function processDevelopmentQueue(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  const origin = request.headers.get("origin")
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Request origin could not be verified." }, { status: 403, headers: { "Cache-Control": "no-store" } })
  }

  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) return Response.json({ error: "Sign in to process development transcripts." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const access = await getEffectivePermissions(email)
  if (access.role !== "admin") return Response.json({ error: "Only an admin can process the development transcript queue." }, { status: 403, headers: { "Cache-Control": "no-store" } })

  const fetched = await processTeamsTranscriptQueue(5)
  const extracted = await processTeamsTranscriptExtractionQueue(2)
  await recordAuditEvent({
    actorEmail: email,
    action: "teams_transcript_development_queue_processed",
    targetType: "teams_transcript_queue",
    metadata: {
      fetched: fetched.processed,
      fetchFailures: fetched.failed,
      extracted: extracted.processed,
      savedDrafts: extracted.savedDrafts,
      extractionFailures: extracted.failed,
    },
    ...getAuditContext(request),
  })

  return Response.json({ fetched, extracted }, { headers: { "Cache-Control": "no-store" } })
}

export const POST = withOperationalCapture("/api/teams/transcripts/dev/process", "POST", processDevelopmentQueue)
