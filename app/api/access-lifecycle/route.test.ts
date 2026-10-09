/**
 * Tests lifecycle authority, protected admins, and bounded operational delegation.
 * Persistent rows and audit operations are mocked; Microsoft access is untouched.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn(),getUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({getManagedAccessUser:vi.fn(),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/access-lifecycle-store",()=>({getAccountLifecycle:vi.fn(),listAccessLifecycle:vi.fn(),saveAccountLifecycle:vi.fn(),createTemporaryAssignment:vi.fn(),revokeTemporaryAssignment:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole,getUserRole } from "@/lib/access"
import { getManagedAccessUser } from "@/lib/db"
import { getAccountLifecycle,saveAccountLifecycle,createTemporaryAssignment } from "@/lib/access-lifecycle-store"
import { resolvePermissions } from "@/lib/permissions"
import { POST } from "./route"
/** @param input - Explicit synthetic mutation. @returns JSON lifecycle request. */
function request(input:object){return new Request("http://localhost/tanovo-time/api/access-lifecycle",{method:"POST",body:JSON.stringify(input)})}
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"operator@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(getManagedAccessUser).mockResolvedValue(null);vi.mocked(getAccountLifecycle).mockResolvedValue(null)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee");vi.mocked(getUserRole).mockReturnValue(null)
})
it("does not schedule automatic cutoff for recovery administrators",async()=>{
  vi.mocked(getUserRole).mockReturnValue("admin")
  expect((await POST(request({action:"schedule_cutoff",email:"owner@example.com",cutoffAt:"2099-01-01T00:00:00Z",reason:"Departure"}))).status).toBe(409)
  expect(saveAccountLifecycle).not.toHaveBeenCalled()
})
it("prevents managers from suspending an account",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  expect((await POST(request({action:"suspend",email:"staff@example.com",reviewAt:"2099-01-01T00:00:00Z",reason:"Leave"}))).status).toBe(403)
})
it("requires explicit whole-application scope for review grants",async()=>{
  expect((await POST(request({action:"grant",email:"staff@example.com",scope:"own",permissions:["review_entries"],startsAt:"2099-01-01T00:00:00Z",endsAt:"2099-01-02T00:00:00Z",reason:"Coverage"}))).status).toBe(400)
  expect(createTemporaryAssignment).not.toHaveBeenCalled()
})
it("rejects financial permissions in temporary assignment payloads",async()=>{
  expect((await POST(request({action:"grant",email:"staff@example.com",scope:"all",permissions:["view_accounts"],startsAt:"2099-01-01T00:00:00Z",endsAt:"2099-01-02T00:00:00Z",reason:"Coverage"}))).status).toBe(400)
})
it("does not let managers grant a permission they no longer hold",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{review_entries:false})})
  expect((await POST(request({action:"grant",email:"staff@example.com",scope:"all",permissions:["review_entries"],startsAt:"2099-01-01T00:00:00Z",endsAt:"2099-01-02T00:00:00Z",reason:"Coverage"}))).status).toBe(403)
})
