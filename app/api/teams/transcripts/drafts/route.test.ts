import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getEffectivePermissions: vi.fn(),
  getTeamsTranscriptDraftSavedEntries: vi.fn(),
  isTimesheetPeriodArchived: vi.fn(),
  listTimeProjects: vi.fn(),
  listTimesheetPeriods: vi.fn(),
  recordAuditEvent: vi.fn(),
  saveTeamsTranscriptDraftEntries: vi.fn(),
  listAccountIdentities: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: mocks.getEffectivePermissions }))
vi.mock("@/lib/db", () => ({
  getTeamsTranscriptDraftSavedEntries: mocks.getTeamsTranscriptDraftSavedEntries,
  isTimesheetPeriodArchived: mocks.isTimesheetPeriodArchived,
  listTimeProjects: mocks.listTimeProjects,
  listTimesheetPeriods: mocks.listTimesheetPeriods,
  recordAuditEvent: mocks.recordAuditEvent,
  saveTeamsTranscriptDraftEntries: mocks.saveTeamsTranscriptDraftEntries,
}))
vi.mock("@/lib/teams-transcript-inbox", () => ({
  listTeamsTranscriptDrafts: vi.fn(),
  listTeamsTranscriptExtractionStatus: vi.fn(),
  retryTeamsTranscriptExtraction: vi.fn(),
  updateTeamsTranscriptDraftStatus: vi.fn(),
}))
vi.mock("@/lib/teams-transcript-artifact-crypto", () => ({ decryptTeamsTranscript: vi.fn() }))
vi.mock("@/lib/account-identities", () => ({ listAccountIdentities: mocks.listAccountIdentities }))
vi.mock("@/lib/audit", () => ({ getAuditContext: () => ({ requestMethod: "POST", requestPath: "/api/teams/transcripts/drafts" }) }))
vi.mock("@/lib/api-outcome-capture", () => ({
  withOperationalCapture: (_route: string, _method: string, handler: (request: Request) => Promise<Response>) => handler,
}))

import { POST } from "./route"

const draftId = "10000000-0000-4000-8000-000000000002"
const periodId = "10000000-0000-4000-8000-000000000001"
const savedEntry = { id: "entry-1", date: "2026-10-17", hours: 2, project: "Field service", description: "Site inspection" }

function saveRequest() {
  return new Request("https://app.example/api/teams/transcripts/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: draftId,
      periodId,
      entries: [{ contractor: "Self", date: "2026-10-17", hours: 2, project: "Field service", description: "Site inspection" }],
    }),
  })
}

describe("save Teams transcript draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: "patron@example.com" } })
    mocks.getEffectivePermissions.mockResolvedValue({ role: "contractor", permissions: { create_entries: true } })
    mocks.getTeamsTranscriptDraftSavedEntries.mockResolvedValue([])
    mocks.listTimesheetPeriods.mockResolvedValue([{ id: periodId, name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31" }])
    mocks.isTimesheetPeriodArchived.mockResolvedValue(false)
    mocks.listTimeProjects.mockResolvedValue([{ id: "project-1", name: "Field service" }])
    mocks.listAccountIdentities.mockResolvedValue([{ officialName: "Patron Name", contractorNumber: "TN-001" }])
    mocks.saveTeamsTranscriptDraftEntries.mockResolvedValue({ status: "saved", entries: [savedEntry] })
  })

  it("saves reviewed entries through the atomic transcript-draft operation", async () => {
    const response = await POST(saveRequest())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ entries: [savedEntry], alreadySaved: false })
    expect(mocks.saveTeamsTranscriptDraftEntries).toHaveBeenCalledWith(expect.objectContaining({
      draftId,
      ownerEmail: "patron@example.com",
      contractor: "Patron Name",
      contractorNumber: "TN-001",
      entries: [expect.objectContaining({ date: "2026-10-17", project: "Field service", contractor: "Patron Name" })],
    }))
  })

  it("returns previously saved entries on a retry without creating them again", async () => {
    mocks.getTeamsTranscriptDraftSavedEntries.mockResolvedValue([savedEntry])
    const response = await POST(saveRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [savedEntry], alreadySaved: true })
    expect(mocks.saveTeamsTranscriptDraftEntries).not.toHaveBeenCalled()
  })

  it("rejects a transcript proposal containing a project outside the patron's assignments", async () => {
    mocks.listTimeProjects.mockResolvedValue([])
    const response = await POST(saveRequest())
    expect(response.status).toBe(422)
    expect(mocks.saveTeamsTranscriptDraftEntries).not.toHaveBeenCalled()
  })
})
