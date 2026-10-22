/**
 * Scheduled-only entry point for Teams transcript ingestion and AI drafting.
 * The endpoint has no patron-facing action: a deployment cron bearer token is
 * required, and returned counts contain job status only, never transcript text.
 */
import { processTeamsTranscriptQueue } from "@/lib/teams-transcript-worker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Validates the scheduler boundary and runs one bounded worker batch. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("scheduled") !== "1") {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  try {
    return Response.json(await processTeamsTranscriptQueue(), { headers: { "Cache-Control": "no-store" } })
  } catch {
    console.error("[teams-transcripts] scheduled processing failed")
    return Response.json({ error: "Transcript processing is temporarily unavailable." }, { status: 503 })
  }
}
