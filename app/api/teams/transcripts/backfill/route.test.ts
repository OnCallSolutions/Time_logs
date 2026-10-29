import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getOrganizer: vi.fn(),
  getAccessToken: vi.fn(),
  enqueue: vi.fn(),
  callGraph: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/teams-transcript-connections", () => ({
  getTeamsTranscriptOrganizer: mocks.getOrganizer,
  getTeamsTranscriptAccessToken: mocks.getAccessToken,
}))
vi.mock("@/lib/teams-transcript-inbox", () => ({ enqueueTeamsTranscriptBackfill: mocks.enqueue }))
vi.mock("@/lib/integrations/http", () => ({ callIntegrationApi: mocks.callGraph }))
vi.mock("@/lib/db", () => ({ recordAuditEvent: mocks.recordAuditEvent }))
vi.mock("@/lib/audit", () => ({ getAuditContext: () => ({ requestMethod: "POST", requestPath: "/api/teams/transcripts/backfill" }) }))
vi.mock("@/lib/api-outcome-capture", () => ({ withOperationalCapture: (_path: string, _method: string, handler: unknown) => handler }))

import { POST } from "./route"

const organizerId = "c16a6df9-4f18-4f5e-9c79-12c5c0e68031"
const tenantId = "914a6908-7be5-4b27-9654-3f028ec376f2"

function dateDaysAgo(days: number) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function request(from: string, through: string) {
  return new Request("https://example.test/tanovo-time/api/teams/transcripts/backfill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, through }),
  })
}

describe("Teams historical transcript backfill", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: "patron@example.test" } })
    mocks.getOrganizer.mockResolvedValue({ entra_tenant_id: tenantId, entra_user_id: organizerId, entra_email: "organizer@example.test", subscription_id: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54", capture_enabled: true })
    mocks.getAccessToken.mockResolvedValue("delegated-token")
    mocks.callGraph.mockImplementation(async (call: { operation: string }) => {
      if (call.operation === "find_organizer_calendar_meetings_for_transcript_backfill") return { value: [{
        organizer: { emailAddress: { address: "organizer@example.test" } },
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
        onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/test" },
      }] }
      if (call.operation === "resolve_organizer_online_meeting_for_transcript_backfill") return { value: [{ id: "meeting-1" }] }
      return { value: [{ id: "transcript-1", meetingId: "meeting-1", createdDateTime: "2026-10-19T12:00:00.000Z" }] }
    })
    mocks.enqueue.mockResolvedValue({ queued: 1, duplicates: 0 })
  })

  it("queues existing transcripts for the connected organizer", async () => {
    const response = await POST(request(dateDaysAgo(10), dateDaysAgo(1)))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: 1, meetingsChecked: 1, queued: 1, duplicates: 0, truncated: false })
    expect(mocks.getAccessToken).toHaveBeenCalledWith("patron@example.test", tenantId, organizerId)
    expect(mocks.callGraph).toHaveBeenCalledTimes(3)
    expect(mocks.callGraph).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "/me/calendarView" }))
    expect(mocks.callGraph).toHaveBeenNthCalledWith(3, expect.objectContaining({ path: "/me/onlineMeetings/meeting-1/transcripts" }))
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: "patron@example.test",
      organizerUserId: organizerId,
      transcripts: [expect.objectContaining({
        resource: `users/${organizerId}/onlineMeetings('meeting-1')/transcripts('transcript-1')`,
        transcriptId: "transcript-1",
      })],
    }))
  })

  it("rejects invalid date windows before calling Microsoft Graph", async () => {
    const response = await POST(request(dateDaysAgo(100), dateDaysAgo(1)))
    expect(response.status).toBe(400)
    expect(mocks.callGraph).not.toHaveBeenCalled()
  })

  it("does not search when an administrator has paused transcript capture", async () => {
    mocks.getOrganizer.mockResolvedValueOnce({ entra_tenant_id: tenantId, entra_user_id: organizerId, entra_email: "organizer@example.test", subscription_id: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54", capture_enabled: false })
    const response = await POST(request(dateDaysAgo(10), dateDaysAgo(1)))
    expect(response.status).toBe(403)
    expect(mocks.callGraph).not.toHaveBeenCalled()
  })
})
