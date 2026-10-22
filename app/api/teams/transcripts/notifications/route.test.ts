import { beforeEach, describe, expect, it, vi } from "vitest"

const { enqueueTeamsTranscriptNotification } = vi.hoisted(() => ({
  enqueueTeamsTranscriptNotification: vi.fn(),
}))

vi.mock("@/lib/api-outcome-capture", () => ({
  withOperationalCapture: (_route: string, _method: string, handler: (request: Request) => Promise<Response>) => handler,
}))
vi.mock("@/lib/teams-transcript-inbox", () => ({ enqueueTeamsTranscriptNotification }))

import { POST } from "./route"

const organizerId = "c16a6df9-4f18-4f5e-9c79-12c5c0e68031"

function notificationBody() {
  return JSON.stringify({ value: [{
    subscriptionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
    clientState: "0123456789abcdef0123456789abcdef",
    changeType: "created",
    resource: `users/${organizerId}/onlineMeetings('meeting')/transcripts('transcript')`,
    tenantId: "914a6908-7be5-4b27-9654-3f028ec376f2",
    resourceData: { id: "transcript" },
  }] })
}

describe("Teams transcript notification route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enqueueTeamsTranscriptNotification.mockResolvedValue(true)
  })

  it("answers Graph's validation handshake with the decoded plain-text token", async () => {
    const response = await POST(new Request("https://app.example/api/teams/transcripts/notifications?validationToken=a%2Bb"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/plain")
    expect(await response.text()).toBe("a+b")
    expect(enqueueTeamsTranscriptNotification).not.toHaveBeenCalled()
  })

  it("persists a valid notification and acknowledges it with 202", async () => {
    const response = await POST(new Request("https://app.example/api/teams/transcripts/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: notificationBody(),
    }))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: 1 })
    expect(enqueueTeamsTranscriptNotification).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      providerTranscriptId: "transcript",
    }))
  })

  it("rejects malformed payloads without queueing them", async () => {
    const response = await POST(new Request("https://app.example/api/teams/transcripts/notifications", {
      method: "POST",
      body: "{not-json",
    }))
    expect(response.status).toBe(400)
    expect(enqueueTeamsTranscriptNotification).not.toHaveBeenCalled()
  })

  it("limits chunked bodies even when Content-Length is absent", async () => {
    const response = await POST(new Request("https://app.example/api/teams/transcripts/notifications", {
      method: "POST",
      body: "x".repeat(128_001),
      duplex: "half",
    } as RequestInit))
    expect(response.status).toBe(413)
    expect(enqueueTeamsTranscriptNotification).not.toHaveBeenCalled()
  })
})
