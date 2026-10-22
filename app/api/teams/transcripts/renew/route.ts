/** Protected scheduler endpoint that keeps organizer transcript subscriptions alive. */
import { renewDueTeamsTranscriptSubscriptions } from "@/lib/teams-transcript-subscriptions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("scheduled") !== "1") {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  try {
    return Response.json(await renewDueTeamsTranscriptSubscriptions(), { headers: { "Cache-Control": "no-store" } })
  } catch {
    console.error("[teams-transcripts] subscription renewal failed")
    return Response.json({ error: "Transcript subscriptions could not be renewed." }, { status: 503 })
  }
}
