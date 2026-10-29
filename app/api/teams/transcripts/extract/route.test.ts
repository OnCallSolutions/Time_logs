import { beforeEach, describe, expect, it, vi } from "vitest"

const { processQueue } = vi.hoisted(() => ({ processQueue: vi.fn() }))
vi.mock("@/lib/teams-transcript-worker", () => ({ processTeamsTranscriptExtractionQueue: processQueue }))

import { GET } from "./route"

describe("scheduled Teams transcript extraction route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "scheduled-secret"
  })

  it("requires both the scheduled marker and the cron bearer token", async () => {
    const missingMarker = await GET(new Request("https://example.test/api/teams/transcripts/extract"))
    const missingSecret = await GET(new Request("https://example.test/api/teams/transcripts/extract?scheduled=1"))
    expect(missingMarker.status).toBe(404)
    expect(missingSecret.status).toBe(401)
    expect(processQueue).not.toHaveBeenCalled()
  })

  it("runs the separately bounded extraction queue for an authenticated scheduler", async () => {
    processQueue.mockResolvedValue({ processed: 2, savedDrafts: 1, failed: 1 })
    const response = await GET(new Request("https://example.test/api/teams/transcripts/extract?scheduled=1", { headers: { authorization: "Bearer scheduled-secret" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ processed: 2, savedDrafts: 1, failed: 1 })
    expect(processQueue).toHaveBeenCalledOnce()
  })
})
