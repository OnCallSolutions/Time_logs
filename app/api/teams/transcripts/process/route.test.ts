import { beforeEach, describe, expect, it, vi } from "vitest"

const { processQueue } = vi.hoisted(() => ({ processQueue: vi.fn() }))
vi.mock("@/lib/teams-transcript-worker", () => ({ processTeamsTranscriptQueue: processQueue }))

import { GET } from "./route"

describe("scheduled Teams transcript worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "scheduled-secret"
  })

  it("does not expose a callable processing route without the scheduled marker and secret", async () => {
    const missingMarker = await GET(new Request("https://example.test/api/teams/transcripts/process"))
    const missingSecret = await GET(new Request("https://example.test/api/teams/transcripts/process?scheduled=1"))
    expect(missingMarker.status).toBe(404)
    expect(missingSecret.status).toBe(401)
    expect(processQueue).not.toHaveBeenCalled()
  })

  it("processes a bounded queue only for an authenticated scheduler", async () => {
    processQueue.mockResolvedValue({ processed: 1, saved: 1, failed: 0, expiredArtifactsDeleted: 0 })
    const response = await GET(new Request("https://example.test/api/teams/transcripts/process?scheduled=1", { headers: { authorization: "Bearer scheduled-secret" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ processed: 1, saved: 1, failed: 0, expiredArtifactsDeleted: 0 })
    expect(processQueue).toHaveBeenCalledOnce()
  })
})
