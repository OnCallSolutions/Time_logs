import { beforeEach, describe, expect, it, vi } from "vitest"

const { callIntegrationApi, saveTeamsTranscriptSubscription } = vi.hoisted(() => ({
  callIntegrationApi: vi.fn(),
  saveTeamsTranscriptSubscription: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/integrations/http", () => ({ callIntegrationApi }))
vi.mock("@/lib/teams-transcript-inbox", () => ({ saveTeamsTranscriptSubscription }))
vi.mock("@/lib/teams-transcript-connections", () => ({ getTeamsTranscriptAccessToken: vi.fn() }))

import { provisionOrganizerTranscriptSubscription } from "./teams-transcript-subscriptions"

const organizerId = "c16a6df9-4f18-4f5e-9c79-12c5c0e68031"
const tenantId = "914a6908-7be5-4b27-9654-3f028ec376f2"

describe("organizer-scoped transcript subscription provisioning", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.TEAMS_TRANSCRIPT_NOTIFICATION_URL = "https://example.test/api/teams/transcripts/notifications"
    callIntegrationApi.mockImplementation(async (call: { path: string }) => call.path === "/me"
      ? { id: organizerId, userPrincipalName: "organizer@example.test" }
      : { id: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54", expirationDateTime: "2026-10-20T18:00:00.000Z", resource: `users/${organizerId}/onlineMeetings/getAllTranscripts` })
  })

  it("verifies organizer identity and stores a subscription bound to the patron and tenant", async () => {
    const result = await provisionOrganizerTranscriptSubscription({
      accessToken: "delegated-access-token",
      ownerEmail: "patron@example.test",
      entraTenantId: tenantId,
      expectedOrganizerUserId: organizerId,
    })
    expect(result.organizerUserId).toBe(organizerId)
    expect(callIntegrationApi).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "/me", method: "GET" }))
    const createCall = callIntegrationApi.mock.calls[1][0]
    expect(createCall.body).toMatchObject({
      changeType: "created",
      resource: `users/${organizerId}/onlineMeetings/getAllTranscripts`,
      notificationUrl: "https://example.test/api/teams/transcripts/notifications",
    })
    expect(Date.parse(createCall.body.expirationDateTime) - Date.now()).toBeLessThan(60 * 60 * 1000)
    expect(createCall.body).not.toHaveProperty("lifecycleNotificationUrl")
    expect(createCall.body.clientState).toHaveLength(43)
    expect(saveTeamsTranscriptSubscription).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: "patron@example.test",
      entraTenantId: tenantId,
      organizerUserId: organizerId,
      clientState: createCall.body.clientState,
    }))
  })

  it("rejects non-HTTPS notification endpoints before calling Graph", async () => {
    process.env.TEAMS_TRANSCRIPT_NOTIFICATION_URL = "http://example.test/notify"
    await expect(provisionOrganizerTranscriptSubscription({ accessToken: "token", ownerEmail: "p@example.test", entraTenantId: tenantId })).rejects.toThrow("public HTTPS")
    expect(callIntegrationApi).not.toHaveBeenCalled()
  })

  it("deletes the remote subscription if local persistence fails", async () => {
    saveTeamsTranscriptSubscription.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(provisionOrganizerTranscriptSubscription({ accessToken: "token", ownerEmail: "p@example.test", entraTenantId: tenantId })).rejects.toThrow("database unavailable")
    expect(callIntegrationApi).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: "/subscriptions/5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      method: "DELETE",
    }))
  })

  it("does not provision if Graph cannot provide a verified organizer ID", async () => {
    callIntegrationApi.mockResolvedValueOnce({ id: "not-an-object-id" })
    await expect(provisionOrganizerTranscriptSubscription({ accessToken: "token", ownerEmail: "p@example.test", entraTenantId: tenantId })).rejects.toThrow("verified Entra object ID")
    expect(callIntegrationApi).toHaveBeenCalledTimes(1)
    expect(saveTeamsTranscriptSubscription).not.toHaveBeenCalled()
  })

  it("does not create a subscription for a different Graph organizer", async () => {
    await expect(provisionOrganizerTranscriptSubscription({
      accessToken: "token",
      ownerEmail: "p@example.test",
      entraTenantId: tenantId,
      expectedOrganizerUserId: "226a6df9-4f18-4f5e-9c79-12c5c0e68031",
    })).rejects.toThrow("did not match the authorized account")
    expect(callIntegrationApi).toHaveBeenCalledTimes(1)
    expect(saveTeamsTranscriptSubscription).not.toHaveBeenCalled()
  })
})
