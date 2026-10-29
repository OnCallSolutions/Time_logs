import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getEffectivePermissions: vi.fn(),
  processFetchQueue: vi.fn(),
  processExtractionQueue: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: mocks.getEffectivePermissions }))
vi.mock("@/lib/teams-transcript-worker", () => ({
  processTeamsTranscriptQueue: mocks.processFetchQueue,
  processTeamsTranscriptExtractionQueue: mocks.processExtractionQueue,
}))
vi.mock("@/lib/db", () => ({ recordAuditEvent: mocks.recordAuditEvent }))
vi.mock("@/lib/audit", () => ({ getAuditContext: () => ({ requestMethod: "POST", requestPath: "/api/teams/transcripts/dev/process" }) }))
vi.mock("@/lib/api-outcome-capture", () => ({
  withOperationalCapture: (_route: string, _method: string, handler: (request: Request) => Promise<Response>) => handler,
}))

import { POST } from "./route"

const request = () => new Request("http://localhost:3000/tanovo-time/api/teams/transcripts/dev/process", {
  method: "POST",
  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
  body: "{}",
})

describe("development Teams transcript processing route", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development")
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: "admin@example.test" } })
    mocks.getEffectivePermissions.mockResolvedValue({ role: "admin" })
    mocks.processFetchQueue.mockResolvedValue({ processed: 1, saved: 1, failed: 0, expiredArtifactsDeleted: 0 })
    mocks.processExtractionQueue.mockResolvedValue({ processed: 1, savedDrafts: 1, failed: 0 })
  })

  it("does not exist outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(mocks.processFetchQueue).not.toHaveBeenCalled()
  })

  it("requires a same-origin admin session before processing queued jobs", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    mocks.auth.mockResolvedValue({ user: { email: "manager@example.test" } })
    mocks.getEffectivePermissions.mockResolvedValue({ role: "manager" })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.processFetchQueue).not.toHaveBeenCalled()
  })

  it("runs bounded fetch and extraction batches and audits aggregate results", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      fetched: { processed: 1, saved: 1, failed: 0, expiredArtifactsDeleted: 0 },
      extracted: { processed: 1, savedDrafts: 1, failed: 0 },
    })
    expect(mocks.processFetchQueue).toHaveBeenCalledWith(5)
    expect(mocks.processExtractionQueue).toHaveBeenCalledWith(2)
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: "admin@example.test",
      action: "teams_transcript_development_queue_processed",
      metadata: { fetched: 1, fetchFailures: 0, extracted: 1, savedDrafts: 1, extractionFailures: 0 },
    }))
  })
})
