/** Covers role-gated organization deadline reads and admin-only audited changes. */
import { beforeEach, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: vi.fn() }))
vi.mock("@/lib/audit", () => ({ getAuditContext: vi.fn(() => ({ ipAddress: null, userAgent: null, requestMethod: "PATCH", requestPath: "/api/submission-deadline", requestId: null })) }))
vi.mock("@/lib/db", () => ({ getTimesheetSubmissionDeadline: vi.fn(), setTimesheetSubmissionDeadline: vi.fn() }))

import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getTimesheetSubmissionDeadline, setTimesheetSubmissionDeadline } from "@/lib/db"
import { GET, PATCH } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "admin@example.com" } } as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "admin", permissions: {} } as never)
  vi.mocked(getTimesheetSubmissionDeadline).mockResolvedValue(null)
  vi.mocked(setTimesheetSubmissionDeadline).mockImplementation(async deadline => deadline)
})

it("lets signed-in patrons read the current boundary", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "contractor", permissions: {} } as never)
  const response = await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toHaveProperty("deadline", null)
})

it("allows only admins to update a future boundary with a reason", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "manager", permissions: {} } as never)
  const forbidden = await PATCH(new Request("http://localhost/api/submission-deadline", { method: "PATCH", body: JSON.stringify({ deadline: "2099-01-01T12:00:00.000Z", reason: "Period cutoff" }) }))
  expect(forbidden.status).toBe(403)
  expect(setTimesheetSubmissionDeadline).not.toHaveBeenCalled()

  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "admin", permissions: {} } as never)
  const deadline = new Date(Date.now() + 86_400_000).toISOString()
  const saved = await PATCH(new Request("http://localhost/api/submission-deadline", { method: "PATCH", body: JSON.stringify({ deadline, reason: "Period cutoff" }) }))
  expect(saved.status).toBe(200)
  expect(setTimesheetSubmissionDeadline).toHaveBeenCalledWith(deadline, "admin@example.com", "Period cutoff", expect.anything())
})

it("rejects a deadline that is already past", async () => {
  const response = await PATCH(new Request("http://localhost/api/submission-deadline", { method: "PATCH", body: JSON.stringify({ deadline: "2020-01-01T00:00:00.000Z", reason: "Late cutoff" }) }))
  expect(response.status).toBe(400)
  expect(setTimesheetSubmissionDeadline).not.toHaveBeenCalled()
})
