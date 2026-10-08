/**
 * Covers administrator control-right updates at the real API validation boundary.
 * Sparse overrides and role-default resets must remain valid without requiring
 * every known permission. Authorization and database writes use isolated mocks.
 */
import { beforeEach, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/access", () => ({ getEffectiveUserRole: vi.fn(), getConfiguredAccessUsers: vi.fn() }))
vi.mock("@/lib/db", () => ({
  getManagedAccessUser: vi.fn(), listKnownUsers: vi.fn(), listManagedAccessUsers: vi.fn(),
  recordAuditEvent: vi.fn(), upsertManagedAccessUser: vi.fn(),
}))
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { getManagedAccessUser, recordAuditEvent, upsertManagedAccessUser } from "@/lib/db"
import { PATCH } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "admin@example.com" } } as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(getManagedAccessUser).mockResolvedValue(null)
  vi.mocked(upsertManagedAccessUser).mockImplementation(async assignment => ({
    ...assignment, note: assignment.note ?? "", createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z",
  }))
})

/**
 * Builds an access editor request with optional permission overrides.
 * @param permissions - Untrusted permission payload under test.
 * @returns Request containing an otherwise valid employee access assignment.
 */
function request(permissions?: unknown): Request {
  return new Request("http://localhost/timelog/api/users", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "employee@example.com", role: "employee", accessStatus: "active", permissions }),
  })
}

it("saves a single permission override", async () => {
  const response = await PATCH(request({ review_entries: true }))
  expect(response.status).toBe(200)
  expect(upsertManagedAccessUser).toHaveBeenCalledWith(expect.objectContaining({ permissions: { review_entries: true } }))
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user_access_created" }))
})

it("accepts an empty object to reset role defaults", async () => {
  vi.mocked(getManagedAccessUser).mockResolvedValue({ permissions: { review_entries: true } } as never)
  expect((await PATCH(request({}))).status).toBe(200)
  expect(upsertManagedAccessUser).toHaveBeenCalledWith(expect.objectContaining({ permissions: {} }))
})

it("preserves existing overrides when permissions are omitted", async () => {
  vi.mocked(getManagedAccessUser).mockResolvedValue({ permissions: { delete_entries: false } } as never)
  expect((await PATCH(request())).status).toBe(200)
  expect(upsertManagedAccessUser).toHaveBeenCalledWith(expect.objectContaining({ permissions: { delete_entries: false } }))
})

it.each([{ unknown_right: true }, { review_entries: "yes" }])("rejects invalid overrides without writing", async permissions => {
  expect((await PATCH(request(permissions))).status).toBe(400)
  expect(upsertManagedAccessUser).not.toHaveBeenCalled()
})

it("rejects non-admin changes", async () => {
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await PATCH(request({ review_entries: true }))).status).toBe(403)
  expect(upsertManagedAccessUser).not.toHaveBeenCalled()
})

it("distinguishes storage failures from input validation", async () => {
  vi.mocked(upsertManagedAccessUser).mockRejectedValue(new Error("Simulated database failure"))
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  expect((await PATCH(request({ review_entries: true }))).status).toBe(500)
  expect(log).toHaveBeenCalledWith("[users] access save failed")
  log.mockRestore()
})
