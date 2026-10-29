/**
 * Patron-facing boundary for encrypted Teams-derived proposals. It exposes only
 * the authenticated patron's extracted rows, and lets that patron dismiss,
 * retry, or explicitly save proposals into the ordinary draft-entry workflow.
 * Project assignment, period boundaries, and current rights are rechecked here;
 * an AI proposal alone never becomes a persisted or submitted timesheet.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { decryptTeamsTranscript } from "@/lib/teams-transcript-artifact-crypto"
import { listTeamsTranscriptDrafts, listTeamsTranscriptExtractionStatus, retryTeamsTranscriptExtraction, updateTeamsTranscriptDraftStatus } from "@/lib/teams-transcript-inbox"
import { getTeamsTranscriptDraftSavedEntries, isTimesheetPeriodArchived, listTimeProjects, listTimesheetPeriods, recordAuditEvent, saveTeamsTranscriptDraftEntries } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { listAccountIdentities } from "@/lib/account-identities"
import { isValidIsoDate } from "@/lib/iso-date"

const entrySchema = z.object({
  date: z.string().refine(isValidIsoDate).nullable(),
  hours: z.number().min(0.25).max(24).nullable(),
  project: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  evidence: z.array(z.object({ cueId: z.number().int().positive(), start: z.string(), end: z.string(), text: z.string().max(4000) })).max(12).default([]),
  reviewFlags: z.array(z.enum(["date_needs_confirmation", "hours_needs_confirmation", "project_needs_confirmation", "evidence_unverified"])).max(4).default([]),
})

/** Resolves the caller's current entry-creation rights; email from request data is never trusted. */
async function currentPatron() {
  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) return null
  const access = await getEffectivePermissions(email)
  return access.permissions.create_entries ? { email, role: access.role } : null
}

/** Returns only this patron's decrypted proposal preview and non-sensitive job state. */
async function getDrafts() {
  try {
    const patron = await currentPatron()
    if (!patron) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const [rows, extractionJobs] = await Promise.all([listTeamsTranscriptDrafts(patron.email), listTeamsTranscriptExtractionStatus(patron.email)])
    const drafts = rows.flatMap(row => {
      try {
        const entries = z.array(entrySchema).parse(JSON.parse(decryptTeamsTranscript(row.entries_ciphertext)))
        return [{ id: row.id, meetingDate: row.meeting_date, createdAt: row.created_at, entries }]
      } catch {
        return []
      }
    })
    return Response.json({ drafts, extractionJobs: extractionJobs.map(({id,meeting_date,status,attempts})=>({id,meetingDate:meeting_date,status,attempts})) }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Transcript drafts are temporarily unavailable." }, { status: 503 })
  }
}

/** Dismisses a proposal or requests a bounded retry for the caller-owned extraction job. */
async function updateDraft(request: Request) {
  try {
    const patron = await currentPatron()
    if (!patron) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const input = z.object({ id: z.string().uuid(), status: z.enum(["dismissed", "retry"]) }).strict().parse(await request.json())
    const changed = input.status === "retry"
      ? await retryTeamsTranscriptExtraction(input.id, patron.email)
      : await updateTeamsTranscriptDraftStatus(input.id, patron.email, input.status)
    if (!changed) return Response.json({ error: "Draft not found or already handled." }, { status: 404 })
    await recordAuditEvent({
      actorEmail: patron.email,
      action: input.status === "dismissed" ? "teams_transcript_draft_dismissed" : "teams_transcript_extraction_retried",
      targetType: input.status === "retry" ? "teams_transcript_extraction" : "teams_transcript_draft",
      targetId: input.id,
      metadata: { status: input.status },
      ...getAuditContext(request),
    })
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Choose a valid transcript draft action." }, { status: 400 })
    return Response.json({ error: "Unable to update transcript draft." }, { status: 503 })
  }
}

/**
 * Saves only a reviewed proposal into ordinary draft entries after rechecking
 * configured period, date range, project assignment, ownership and idempotency.
 */
async function saveDraftEntries(request: Request) {
  try {
    const patron = await currentPatron()
    if (!patron) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const input = z.object({
      id: z.string().uuid(),
      periodId: z.string().uuid(),
      entries: z.array(z.object({
        contractor: z.string().trim().min(1).max(120),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hours: z.number().min(0.25).max(24),
        project: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000),
      }).strict()).min(1).max(100),
    }).strict().parse(await request.json())
    const existing = await getTeamsTranscriptDraftSavedEntries(input.id, patron.email)
    if (existing.length) return Response.json({ entries: existing, alreadySaved: true }, { headers: { "Cache-Control": "no-store" } })
    const period = (await listTimesheetPeriods()).find(candidate => candidate.id === input.periodId)
    if (!period) return Response.json({ error: "Select a configured timesheet period before saving." }, { status: 400 })
    if (input.entries.some(entry => entry.date < period.startDate || entry.date > period.endDate)) return Response.json({ error: `Every work date must fall within ${period.name} (${period.startDate}–${period.endDate}).` }, { status: 422 })
    if ((patron.role === "contractor" || patron.role === "employee") && await isTimesheetPeriodArchived(period.id)) return Response.json({ error: "Past timesheet periods are archived and read-only." }, { status: 409 })
    if (patron.role === "contractor" || patron.role === "employee") {
      const assigned = await listTimeProjects(false, patron.email)
      const allowed = new Map(assigned.map(project => [project.name.toLocaleLowerCase(), project.name]))
      if (input.entries.some(entry => !allowed.has(entry.project.toLocaleLowerCase()))) return Response.json({ error: "A proposed project is not assigned to your account. Ask your manager to assign it first." }, { status: 422 })
      input.entries = input.entries.map(entry => ({ ...entry, project: allowed.get(entry.project.toLocaleLowerCase())!, contractor: entry.contractor }))
    }
    const identity = (await listAccountIdentities([patron.email]))[0]
    const saved = await saveTeamsTranscriptDraftEntries({
      draftId: input.id,
      ownerEmail: patron.email,
      contractor: identity?.officialName ?? input.entries[0].contractor,
      contractorNumber: identity?.contractorNumber,
      entries: input.entries.map(entry => ({ ...entry, contractor: identity?.officialName ?? entry.contractor })),
      context: getAuditContext(request),
    })
    if (saved.status === "unavailable") return Response.json({ error: "Transcript draft was already handled or is no longer available." }, { status: 409 })
    return Response.json({ entries: saved.entries, alreadySaved: saved.status === "already_saved" }, { status: saved.status === "saved" ? 201 : 200, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Review valid work dates, hours, descriptions, and projects before saving." }, { status: 400 })
    return Response.json({ error: "Unable to save transcript entries." }, { status: 503 })
  }
}

export const GET = withOperationalCapture("/api/teams/transcripts/drafts", "GET", getDrafts)
export const PATCH = withOperationalCapture("/api/teams/transcripts/drafts", "PATCH", updateDraft)
export const POST = withOperationalCapture("/api/teams/transcripts/drafts", "POST", saveDraftEntries)
