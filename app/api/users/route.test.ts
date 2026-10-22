/**
 * Covers administrator control-right updates at the real API validation boundary.
 * Sparse overrides and role-default resets must remain valid without requiring
 * every known permission. Authorization and database writes use isolated mocks.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({ensureAccountIdentitiesForActors:vi.fn(async(emails:string[])=>(emails??[]).map(email=>({email,officialName:"Name Not Set Abc12345",contractorNumber:"TN-internal",shortReference:"TN-000001"})))}))

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/access", () => ({ getEffectiveUserRole: vi.fn(), getConfiguredAccessUsers: vi.fn() }))
vi.mock("@/lib/db", () => ({
  getManagedAccessUser: vi.fn(), listKnownUsers: vi.fn(), listManagedAccessUsers: vi.fn(),
  upsertManagedAccessUserWithAudit: vi.fn(),
}))
import { auth } from "@/auth"
import { getEffectiveUserRole,getConfiguredAccessUsers } from "@/lib/access"
import { LastAdministratorError } from "@/lib/admin-policy"
import { getManagedAccessUser, listKnownUsers, listManagedAccessUsers, upsertManagedAccessUserWithAudit } from "@/lib/db"
import { ensureAccountIdentitiesForActors } from "@/lib/account-identities"
import { GET,PATCH } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "admin@example.com" }, appSessionId: "00000000-0000-0000-0000-000000000001" } as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(getConfiguredAccessUsers).mockReturnValue([])
  vi.mocked(getManagedAccessUser).mockResolvedValue(null)
  vi.mocked(upsertManagedAccessUserWithAudit).mockImplementation(async assignment => ({
    ...assignment, note: assignment.note ?? "", createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z",
  }))
})

/**
 * Builds an access editor request with optional permission overrides.
 * @param permissions - Untrusted permission payload under test.
 * @returns Request containing an otherwise valid employee access assignment.
 */
function request(permissions?: unknown, accessStatus = "active", note = "Access update requested for role responsibilities."): Request {
  return new Request("http://localhost/tanovo-time/api/users", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "employee@example.com", role: "employee", accessStatus, permissions, note }),
  })
}

it("saves a single permission override", async () => {
  const response = await PATCH(request({ review_entries: true }))
  expect(response.status).toBe(200)
  expect(upsertManagedAccessUserWithAudit).toHaveBeenCalledWith(expect.objectContaining({ permissions: { review_entries: true } }))
})

it("requires an audit note when an administrator changes effective rights", async () => {
  const response = await PATCH(request({ review_entries: true }, "active", ""))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: "Add an administrator note explaining this access-right change." })
  expect(upsertManagedAccessUserWithAudit).not.toHaveBeenCalled()
})

it.each(["suspended", "retired", "blocked", "denied"])("persists the %s lifecycle state", async status => {
  const response = await PATCH(request({}, status))
  expect(response.status).toBe(200)
  expect(upsertManagedAccessUserWithAudit).toHaveBeenCalledWith(expect.objectContaining({ accessStatus: status }))
})

it("saves a high-impact access change after the normal admin and audit-note checks", async () => {
  const response = await PATCH(request({}, "suspended"))
  expect(response.status).toBe(200)
  expect(upsertManagedAccessUserWithAudit).toHaveBeenCalledWith(expect.objectContaining({ accessStatus: "suspended", note: expect.any(String) }))
})

it("accepts an empty object to reset role defaults", async () => {
  vi.mocked(getManagedAccessUser).mockResolvedValue({ permissions: { review_entries: true } } as never)
  expect((await PATCH(request({}))).status).toBe(200)
  expect(upsertManagedAccessUserWithAudit).toHaveBeenCalledWith(expect.objectContaining({ permissions: {} }))
})

it("preserves existing overrides when permissions are omitted", async () => {
  vi.mocked(getManagedAccessUser).mockResolvedValue({ permissions: { delete_entries: false } } as never)
  expect((await PATCH(request())).status).toBe(200)
  expect(upsertManagedAccessUserWithAudit).toHaveBeenCalledWith(expect.objectContaining({ permissions: { delete_entries: false } }))
})

it.each([{ unknown_right: true }, { review_entries: "yes" }])("rejects invalid overrides without writing", async permissions => {
  expect((await PATCH(request(permissions))).status).toBe(400)
  expect(upsertManagedAccessUserWithAudit).not.toHaveBeenCalled()
})

it("rejects non-admin changes", async () => {
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await PATCH(request({ review_entries: true }))).status).toBe(403)
  expect(upsertManagedAccessUserWithAudit).not.toHaveBeenCalled()
})

it("distinguishes storage failures from input validation", async () => {
  vi.mocked(upsertManagedAccessUserWithAudit).mockRejectedValue(new Error("Simulated database failure"))
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  expect((await PATCH(request({ review_entries: true }))).status).toBe(500)
  expect(log).toHaveBeenCalledWith("[users] access save failed")
  log.mockRestore()
})
it("returns a policy conflict when storage rejects removing the last admin",async()=>{
  vi.mocked(upsertManagedAccessUserWithAudit).mockRejectedValue(new LastAdministratorError())
  const response=await PATCH(request({}))
  expect(response.status).toBe(409)
  expect((await response.json()).error).toContain("At least one active administrator")
})
it("keeps recovery administrators active and displays a safe conflict",async()=>{
  vi.mocked(getConfiguredAccessUsers).mockReturnValue([{email:"admin@example.com",role:"admin"}])
  const response=await PATCH(new Request("http://localhost/tanovo-time/api/users",{method:"PATCH",body:JSON.stringify({email:"admin@example.com",role:"manager",accessStatus:"active"})}))
  expect(response.status).toBe(409)
  expect(upsertManagedAccessUserWithAudit).not.toHaveBeenCalled()
})
it("returns a retryable conflict for concurrent administrator changes",async()=>{
  vi.mocked(upsertManagedAccessUserWithAudit).mockRejectedValue(Object.assign(new Error("Serialization failure"),{code:"40001"}))
  expect((await PATCH(request({}))).status).toBe(409)
})

it("provisions permanent IDs for all server-known directory actors",async()=>{
  vi.mocked(listKnownUsers).mockResolvedValue([])
  vi.mocked(listManagedAccessUsers).mockResolvedValue([])
  vi.mocked(getConfiguredAccessUsers).mockReturnValue([{email:"worker@example.com",role:"employee"}])
  const response=await GET()
  expect(response.status).toBe(200)
  expect(ensureAccountIdentitiesForActors).toHaveBeenCalledWith(["worker@example.com"],"admin@example.com")
  expect((await response.json()).users[0]).toMatchObject({displayName:"Name Not Set Abc12345",companyReference:"TN-000001",contractorNumber:"TN-internal"})
})
