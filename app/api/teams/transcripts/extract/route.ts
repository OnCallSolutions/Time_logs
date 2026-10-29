/**
 * Scheduled-only worker for already-downloaded Teams transcript extraction.
 * Model inference runs outside the Graph download worker so transcript retrieval
 * and identity matching cannot consume the function's AI execution budget.
 */
import { processTeamsTranscriptExtractionQueue } from "@/lib/teams-transcript-worker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Verifies the Vercel cron bearer token and runs at most two bounded AI jobs. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("scheduled") !== "1") {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  try {
    return Response.json(await processTeamsTranscriptExtractionQueue(), { headers: { "Cache-Control": "no-store" } })
  } catch {
    console.error("[teams-transcripts] scheduled extraction failed")
    return Response.json({ error: "Transcript extraction is temporarily unavailable." }, { status: 503 })
  }
}
