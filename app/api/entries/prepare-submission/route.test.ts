/**
 * Tests personal AI submission preparation without live models or database writes.
 * Ownership, explicit rights, exact evidence revisions, and grounded advice are
 * checked independently of UI selection and no submission mutation is imported.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: vi.fn() }))
vi.mock("@/lib/db", () => ({ listTimeEntries: vi.fn() }))
vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), generateText: vi.fn(), Output: { object: vi.fn() } }))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listTimeEntries } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { generateText } from "ai"
import { POST } from "./route"

const id = "20000000-0000-4000-8000-000000000001"
const entry = { id, ownerEmail: "own@example.com", contractor: "Own Person", date: "2026-10-15", project: "Delivery", hours: 2, description: "Documentation", status: "draft" as const, revision: "2026-10-15 00:00:00.123456+00" }
/**
 * Builds a request containing only IDs/revisions, never client evidence fields.
 * @param selection - Explicit desired entry snapshots.
 * @returns Request for the personal preparation endpoint.
 */
function request(selection = [{ id, revision: entry.revision }]): Request {
  return new Request("http://localhost/api/entries/prepare-submission", { method: "POST", body: JSON.stringify({ selection }) })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "own@example.com" } } as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "contractor", permissions: resolvePermissions("contractor") })
  vi.mocked(listTimeEntries).mockResolvedValue([entry])
  vi.mocked(generateText).mockResolvedValue({ output: { items: [{ entryId: id, readiness: "ready", reason: "No obvious omissions." }] } } as never)
})

it("returns advice for owned evidence with no submission mutation", async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.items[0].revision).toBe(entry.revision)
  expect(result.destination).toBe("manager")
  expect(listTimeEntries).toHaveBeenCalledWith("own@example.com", false)
  expect(vi.mocked(generateText).mock.calls[0][0].model).toBe("openai/gpt-5.4-mini")
  expect(vi.mocked(generateText).mock.calls[0][0].prompt).not.toContain("own@example.com")
})
it("denies revoked submission rights before database/model access", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "contractor", permissions: resolvePermissions("contractor", { submit_entries: false }) })
  expect((await POST(request())).status).toBe(403)
  expect(listTimeEntries).not.toHaveBeenCalled()
  expect(generateText).not.toHaveBeenCalled()
})
it("denies account-manager preparation even if a supplied rights object is permissive", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "account_manager", permissions: { ...resolvePermissions("manager"), submit_entries: true } })
  expect((await POST(request())).status).toBe(403)
  expect(generateText).not.toHaveBeenCalled()
})
it("rejects another person's evidence even if a helper returns it", async () => {
  vi.mocked(listTimeEntries).mockResolvedValue([{ ...entry, ownerEmail: "other@example.com" }])
  expect((await POST(request())).status).toBe(403)
  expect(generateText).not.toHaveBeenCalled()
})
it.each(["submitted", "approved"] as const)("does not prepare %s evidence for resubmission", async status => {
  vi.mocked(listTimeEntries).mockResolvedValue([{ ...entry, status }])
  expect((await POST(request())).status).toBe(409)
  expect(generateText).not.toHaveBeenCalled()
})
it("rejects stale evidence before generating advice", async () => {
  expect((await POST(request([{ id, revision: "stale" }]))).status).toBe(409)
  expect(generateText).not.toHaveBeenCalled()
})
it("rejects missing, duplicate, or invented AI coverage", async () => {
  vi.mocked(generateText).mockResolvedValue({ output: { items: [] } } as never)
  expect((await POST(request())).status).toBe(503)
})
it("rechecks permission revocation after model completion", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValueOnce({ role: "contractor", permissions: resolvePermissions("contractor") }).mockResolvedValueOnce({ role: "contractor", permissions: resolvePermissions("contractor", { submit_entries: false }) })
  expect((await POST(request())).status).toBe(403)
})
it("rejects evidence changed during analysis", async () => {
  vi.mocked(listTimeEntries).mockResolvedValueOnce([entry]).mockResolvedValueOnce([{ ...entry, revision: "new" }])
  expect((await POST(request())).status).toBe(409)
})
it("routes manager-owned work to account-manager review", async () => {
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "manager", permissions: resolvePermissions("manager") })
  expect((await (await POST(request())).json()).destination).toBe("account_manager")
})
it("rejects repeated selection IDs and oversized AI batches", async () => {
  expect((await POST(request([{ id, revision: entry.revision }, { id, revision: entry.revision }]))).status).toBe(400)
  expect((await POST(request(Array.from({ length: 51 }, () => ({ id, revision: entry.revision }))))).status).toBe(400)
  expect(generateText).not.toHaveBeenCalled()
})
