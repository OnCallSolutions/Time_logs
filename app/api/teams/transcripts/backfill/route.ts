/** Finds existing organizer-owned meeting transcripts and queues them for normal processing. */
import { auth } from "@/auth"
import { getAuditContext } from "@/lib/audit"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { recordAuditEvent } from "@/lib/db"
import { getTeamsTranscriptAccessToken, getTeamsTranscriptOrganizer } from "@/lib/teams-transcript-connections"
import { enqueueTeamsTranscriptBackfill } from "@/lib/teams-transcript-inbox"
import { callIntegrationApi } from "@/lib/integrations/http"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const inputSchema = z.object({
  from: z.string().date(),
  through: z.string().date(),
}).strict()

type GraphTranscript = { id?: string; meetingId?: string | null; createdDateTime?: string | null }
type GraphTranscriptPage = { value?: GraphTranscript[]; "@odata.nextLink"?: string }
type GraphCalendarEvent = {
  organizer?: { emailAddress?: { address?: string | null } }
  isOnlineMeeting?: boolean
  onlineMeetingProvider?: string
  onlineMeeting?: { joinUrl?: string | null }
}
type GraphCalendarPage = { value?: GraphCalendarEvent[]; "@odata.nextLink"?: string }
type GraphMeetingPage = { value?: Array<{ id?: string }>; "@odata.nextLink"?: string }

function utcDate(value: string, endOfDay = false) {
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
}

async function findPastTranscripts(request: Request) {
  const email = (await auth())?.user?.email?.trim().toLowerCase()
  if (!email) return Response.json({ error: "Sign in before searching meeting transcripts." }, { status: 401 })

  let input: z.infer<typeof inputSchema>
  try {
    input = inputSchema.parse(await request.json())
  } catch {
    return Response.json({ error: "Choose a valid start and end date." }, { status: 400 })
  }

  const from = utcDate(input.from)
  const throughDay = utcDate(input.through)
  const through = new Date(Math.min(utcDate(input.through, true).getTime(), Date.now()))
  const now = Date.now()
  if (from.getTime() > throughDay.getTime() || throughDay.getTime() > now || throughDay.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return Response.json({ error: "Choose a past date range of no more than 90 days." }, { status: 400 })
  }

  try {
    const organizer = await getTeamsTranscriptOrganizer(email)
    if (!organizer || !organizer.subscription_id) {
      return Response.json({ error: "Connect your Teams account first, then try the transcript search again." }, { status: 409 })
    }
    if (!organizer.capture_enabled) {
      return Response.json({ error: "An administrator has paused transcript capture for this organizer account." }, { status: 403 })
    }

    const accessToken = await getTeamsTranscriptAccessToken(email, organizer.entra_tenant_id, organizer.entra_user_id)
    const found: Array<{ resource: string; transcriptId: string; createdAt: string }> = []

    // The delegated getAllTranscripts collection is not supported by Graph.
    // Find organizer-owned calendar meetings, then list transcripts per meeting.
    const calendar = await callIntegrationApi<GraphCalendarPage>({
      provider: "microsoft_graph",
      operation: "find_organizer_calendar_meetings_for_transcript_backfill",
      path: "/me/calendarView",
      method: "GET",
      accessToken,
      query: {
        startDateTime: from.toISOString(),
        endDateTime: through.toISOString(),
        "$select": "organizer,isOnlineMeeting,onlineMeetingProvider,onlineMeeting",
        "$top": 100,
      },
      timeoutMs: 12_000,
    })
    const events = (calendar.value ?? []).filter(event =>
      event.isOnlineMeeting === true
      && event.onlineMeetingProvider === "teamsForBusiness"
      && event.organizer?.emailAddress?.address?.toLowerCase() === organizer.entra_email.toLowerCase()
      && !!event.onlineMeeting?.joinUrl,
    ).slice(0, 8)

    for (let offset = 0; offset < events.length; offset += 4) {
      const batch = events.slice(offset, offset + 4)
      const batchResults = await Promise.all(batch.map(async event => {
        const joinUrl = event.onlineMeeting?.joinUrl
        if (!joinUrl) return []
        const meetingPage = await callIntegrationApi<GraphMeetingPage>({
          provider: "microsoft_graph",
          operation: "resolve_organizer_online_meeting_for_transcript_backfill",
          path: "/me/onlineMeetings",
          method: "GET",
          accessToken,
          query: { "$filter": `JoinWebUrl eq '${joinUrl.replaceAll("'", "''")}'`, "$select": "id", "$top": 1 },
          timeoutMs: 10_000,
        })
        const meetingId = meetingPage.value?.[0]?.id
        if (!meetingId) return []
        const transcriptPage = await callIntegrationApi<GraphTranscriptPage>({
          provider: "microsoft_graph",
          operation: "list_transcripts_for_existing_organizer_meeting",
          path: `/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
          method: "GET",
          accessToken,
          query: { "$top": 100 },
          timeoutMs: 10_000,
        })
        return (transcriptPage.value ?? []).flatMap(transcript => {
          if (!transcript.id || !transcript.meetingId) return []
          const created = transcript.createdDateTime && Number.isFinite(Date.parse(transcript.createdDateTime))
            ? new Date(transcript.createdDateTime)
            : new Date()
          return [{
            resource: `users/${organizer.entra_user_id}/onlineMeetings('${transcript.meetingId}')/transcripts('${transcript.id}')`,
            transcriptId: transcript.id,
            createdAt: created.toISOString(),
          }]
        })
      }))
      for (const batchResult of batchResults) found.push(...batchResult)
    }

    const result = await enqueueTeamsTranscriptBackfill({ ownerEmail: email, organizerUserId: organizer.entra_user_id, transcripts: found })
    await recordAuditEvent({
      actorEmail: email,
      action: "teams_transcript_backfill_requested",
      targetType: "teams_transcript_source",
      targetId: organizer.entra_user_id,
      metadata: { from: input.from, through: input.through, meetingsChecked: events.length, found: found.length, queued: result.queued, duplicates: result.duplicates },
      ...getAuditContext(request),
    })
    return Response.json({ found: found.length, meetingsChecked: events.length, ...result, truncated: events.length === 8 || !!calendar["@odata.nextLink"] }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[teams-transcripts] historical transcript lookup failed", error)
    return Response.json({ error: "Could not search this organizer's past transcripts. Check the Teams connection and permissions, then retry." }, { status: 503 })
  }
}

export const POST = withOperationalCapture("/api/teams/transcripts/backfill", "POST", findPastTranscripts)
