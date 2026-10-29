/**
 * Background orchestration for post-meeting Teams transcript intake.
 *
 * The worker coordinates Graph fetches, encrypted artifact storage, attendance
 * matching, per-patron extraction jobs, and draft persistence. It is deliberately
 * separate from the extraction model: each boundary can be retried and audited
 * without granting the model access to Graph credentials or write authority.
 */
import "server-only"
import { createHash } from "node:crypto"
import { IntegrationApiError, callIntegrationApi } from "@/lib/integrations/http"
import { claimTeamsTranscriptJob, claimTeamsTranscriptExtractionJob, completeTeamsTranscriptExtraction, deleteExpiredTeamsTranscriptArtifacts, enqueueTeamsTranscriptExtraction, failTeamsTranscriptExtraction, failTeamsTranscriptJob, getTeamsTranscriptArtifactForExtraction, saveFetchedTeamsTranscript, saveTeamsTranscriptDraft, type TeamsTranscriptExtractionJob } from "@/lib/teams-transcript-inbox"
import { getTeamsTranscriptAccessToken } from "@/lib/teams-transcript-connections"
import { decryptTeamsTranscript, encryptTeamsTranscript } from "@/lib/teams-transcript-artifact-crypto"
import { parseTeamsTranscriptResource } from "@/lib/teams-transcript-notifications"
import { listAccountIdentities } from "@/lib/account-identities"
import { listTimeProjects } from "@/lib/db"
import { extractTeamsVttSpeakerLabels, resolveTeamsSpeakerAttributions, type TeamsAttendanceRecord, type TeamsSpeakerAttribution } from "@/lib/teams-transcript-attribution"
import { extractTranscriptDraftEntries, transcriptUtterancesForSpeaker } from "@/lib/teams-transcript-extraction"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { z } from "zod"

const MAX_TRANSCRIPT_CHARACTERS = 4_000_000
const speakerAttributionSchema = z.array(z.object({
  speakerName: z.string(),
  patronEmail: z.string().email().nullable(),
  attribution: z.enum(["resolved", "unmatched", "ambiguous", "unattributed"]),
}))

type AttendanceReport = { id: string; meetingStartDateTime?: string; meetingEndDateTime?: string }
type AttendanceRecordsResponse = { value?: TeamsAttendanceRecord[]; "@odata.nextLink"?: string }

async function loadMeetingAttendance(accessToken: string, organizerId: string, meetingId: string, notificationTime: string) {
  // Match the notification to a completed report; reject near-ties rather than risk assigning speech to the wrong meeting.
  const reportResponse = await callIntegrationApi<{ value?: AttendanceReport[] }>({
    provider: "microsoft_graph",
    operation: "list_meeting_attendance_reports",
    path: `/users/${encodeURIComponent(organizerId)}/onlineMeetings/${encodeURIComponent(meetingId)}/attendanceReports`,
    method: "GET",
    accessToken,
    query: { "$select": "id,meetingStartDateTime,meetingEndDateTime", "$top": 50 },
  })
  const reports = reportResponse.value ?? []
  const reference = new Date(notificationTime).getTime()
  const candidates = reports.flatMap(report => {
    const end = report.meetingEndDateTime ? new Date(report.meetingEndDateTime).getTime() : Number.NaN
    return report.id && Number.isFinite(end) && end <= reference + 5 * 60_000 && reference - end <= 48 * 60 * 60_000
      ? [{ report, distance: Math.abs(reference - end) }]
      : []
  }).sort((a, b) => a.distance - b.distance)
  if (!candidates.length) throw new Error("ATTENDANCE_REPORT_NOT_FOUND")
  if (candidates.length > 1 && Math.abs(candidates[1].distance - candidates[0].distance) < 2 * 60_000) throw new Error("ATTENDANCE_REPORT_AMBIGUOUS")

  const recordResponse = await callIntegrationApi<AttendanceRecordsResponse>({
    provider: "microsoft_graph",
    operation: "list_meeting_attendance_records",
    path: `/users/${encodeURIComponent(organizerId)}/onlineMeetings/${encodeURIComponent(meetingId)}/attendanceReports/${encodeURIComponent(candidates[0].report.id)}/attendanceRecords`,
    method: "GET",
    accessToken,
    query: { "$top": 500 },
  })
  if (recordResponse["@odata.nextLink"]) throw new Error("ATTENDANCE_ROSTER_PAGINATED")
  return { records: recordResponse.value ?? [], meetingStartDateTime: candidates[0].report.meetingStartDateTime ?? notificationTime }
}

function safeFailureCode(error: unknown) {
  // Store stable, sanitized diagnostic codes only; provider responses and transcript contents can contain sensitive data.
  if (error instanceof IntegrationApiError) return error.diagnostic.code
  if (error instanceof Error && /^[A-Z0-9_.-]{1,80}$/.test(error.message)) return error.message
  return "TRANSCRIPT_PROCESSING_FAILED"
}

/**
 * Claims and processes patron-specific AI jobs on a schedule separate from
 * Microsoft Graph downloads. This prevents transcript-fetch latency from
 * consuming the extraction function's bounded inference window.
 */
export async function processTeamsTranscriptExtractionQueue(batchSize = 2) {
  // Each claimed job is patron-scoped and independent so one bad artifact cannot block unrelated queue items.
  const limit = Math.min(Math.max(Math.trunc(batchSize), 1), 2)
  let processed = 0
  let savedDrafts = 0
  let failed = 0
  while (processed < limit) {
    const job = await claimTeamsTranscriptExtractionJob()
    if (!job) break
    processed += 1
    try {
      const permission = await getEffectivePermissions(job.ownerEmail)
      if (!permission.permissions.create_entries) {
        await completeTeamsTranscriptExtraction(job.id)
        continue
      }
      const artifact = await getTeamsTranscriptArtifactForExtraction(job.sourceJobId)
      if (!artifact?.speaker_attribution_ciphertext) throw new Error("SOURCE_ARTIFACT_UNAVAILABLE")
      const attributions: TeamsSpeakerAttribution[] = speakerAttributionSchema.parse(JSON.parse(decryptTeamsTranscript(artifact.speaker_attribution_ciphertext)))
      const matching = attributions.filter(item => item.attribution === "resolved" && item.patronEmail?.toLowerCase() === job.ownerEmail.toLowerCase())
      if (matching.length !== 1) throw new Error("SPEAKER_ATTRIBUTION_AMBIGUOUS")
      const transcript = decryptTeamsTranscript(artifact.content_ciphertext)
      const ownSpeech = transcriptUtterancesForSpeaker(transcript, matching[0])
      const assignedProjects = await listTimeProjects(false, job.ownerEmail)
      const entries = await extractTranscriptDraftEntries(ownSpeech, job.meetingDate, assignedProjects.map(project => project.name))
      if (entries.length) {
        await saveTeamsTranscriptDraft({
          sourceJobId: job.sourceJobId,
          ownerEmail: job.ownerEmail,
          meetingDate: job.meetingDate,
          encryptedEntries: encryptTeamsTranscript(JSON.stringify(entries)),
          entryCount: entries.length,
        })
        savedDrafts += 1
      }
      await completeTeamsTranscriptExtraction(job.id)
    } catch (error) {
      await failTeamsTranscriptExtraction(job, safeFailureCode(error))
      failed += 1
    }
  }
  return { processed, savedDrafts, failed }
}

/** Fetches queued VTT artifacts; AI extraction is delegated to its own scheduled worker. */
export async function processTeamsTranscriptQueue(batchSize = 10) {
  // Bound work per serverless invocation; database claims make overlapping cron invocations safe.
  const limit = Math.min(Math.max(Math.trunc(batchSize), 1), 20)
  const expiredArtifactsDeleted = await deleteExpiredTeamsTranscriptArtifacts()
  let saved = 0
  let failed = 0
  let processed = 0

  while (processed < limit) {
    const job = await claimTeamsTranscriptJob()
    if (!job) break
    processed += 1
    try {
      const resource = parseTeamsTranscriptResource(job.providerResource)
      if (!resource || resource.organizerUserId.toLowerCase() !== job.organizerUserId.toLowerCase()) {
        throw new Error("INVALID_TRANSCRIPT_RESOURCE")
      }
      if (job.providerTranscriptId && job.providerTranscriptId !== resource.transcriptId) {
        throw new Error("TRANSCRIPT_ID_MISMATCH")
      }

      const accessToken = await getTeamsTranscriptAccessToken(job.ownerEmail, job.entraTenantId, job.organizerUserId)
      const content = await callIntegrationApi<string>({
        provider: "microsoft_graph",
        operation: "fetch_meeting_transcript_content",
        path: `/users/${encodeURIComponent(resource.organizerUserId)}/onlineMeetings/${encodeURIComponent(resource.meetingId)}/transcripts/${encodeURIComponent(resource.transcriptId)}/content`,
        method: "GET",
        accessToken,
        accept: "text/vtt",
        responseType: "text",
        maxResponseBytes: MAX_TRANSCRIPT_CHARACTERS,
        timeoutMs: 20_000,
      })
      if (!content.trim() || !content.startsWith("WEBVTT")) throw new Error("TRANSCRIPT_FORMAT_UNSUPPORTED")

      let encryptedSpeakerAttribution: string | null = null
      let attributionStatus: "resolved" | "unresolved" | "unavailable" = "unavailable"
      let attributionErrorCode: string | null = null
      let speakerAttributions: ReturnType<typeof resolveTeamsSpeakerAttributions> = []
      let meetingDate = job.receivedAt.slice(0, 10)
      try {
        const attendanceToken = await getTeamsTranscriptAccessToken(job.ownerEmail, job.entraTenantId, job.organizerUserId, true)
        const attendance = await loadMeetingAttendance(attendanceToken, resource.organizerUserId, resource.meetingId, job.receivedAt)
        const patrons = await listAccountIdentities()
        speakerAttributions = resolveTeamsSpeakerAttributions(extractTeamsVttSpeakerLabels(content), attendance.records, patrons)
        meetingDate = attendance.meetingStartDateTime.slice(0, 10)
        encryptedSpeakerAttribution = encryptTeamsTranscript(JSON.stringify(speakerAttributions))
        attributionStatus = speakerAttributions.length > 0 && speakerAttributions.every(item => item.attribution === "resolved") ? "resolved" : "unresolved"
      } catch (error) {
        attributionErrorCode = safeFailureCode(error)
      }

      await saveFetchedTeamsTranscript({
        job,
        meetingId: resource.meetingId,
        transcriptId: resource.transcriptId,
        encryptedContent: encryptTeamsTranscript(content),
        contentType: "text/vtt",
        contentSha256: createHash("sha256").update(content, "utf8").digest("hex"),
        encryptedSpeakerAttribution,
        attributionStatus,
        attributionErrorCode,
      })
      if (speakerAttributions.length && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
        const resolved = speakerAttributions.filter(attribution => attribution.attribution === "resolved" && attribution.patronEmail)
        const counts = new Map<string, number>()
        for (const attribution of resolved) {
          const email = attribution.patronEmail!.toLowerCase()
          counts.set(email, (counts.get(email) ?? 0) + 1)
        }
        for (const attribution of resolved) {
          if (!attribution.patronEmail || counts.get(attribution.patronEmail.toLowerCase()) !== 1) continue
          const permission = await getEffectivePermissions(attribution.patronEmail)
          if (!permission.permissions.create_entries) continue
          await enqueueTeamsTranscriptExtraction({ sourceJobId: job.id, ownerEmail: attribution.patronEmail, meetingDate })
        }
      }
      saved += 1
    } catch (error) {
      await failTeamsTranscriptJob(job, safeFailureCode(error))
      failed += 1
    }
  }

  return { processed, saved, failed, expiredArtifactsDeleted }
}
