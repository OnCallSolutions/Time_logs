/**
 * Verifies delegated rights cannot exceed manager authority or promote accounts.
 * Uses isolated database mocks to avoid changing real employee assignments.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn(),delegateEmployeePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({employeeRoster:vi.fn(),actorRoster:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { employeeRoster,actorRoster } from "@/lib/collaboration"
import { delegateEmployeePermissions } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { GET,PATCH } from "./route"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(employeeRoster).mockResolvedValue([{email:"employee@example.com",role:"employee"}])
  vi.mocked(delegateEmployeePermissions).mockResolvedValue({email:"employee@example.com",role:"employee"} as never)
})
it("lists every actor without permitting manager edits to higher roles",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([{email:"admin@example.com",role:"admin",accessStatus:"active",displayName:"Admin"},{email:"manager@example.com",role:"manager",accessStatus:"active",displayName:"Manager"},{email:"employee@example.com",role:"employee",accessStatus:"active",displayName:"Employee"}])
  const response=await GET()
  expect((await response.json()).users.map((user:{email:string})=>user.email)).toEqual(["admin@example.com","manager@example.com","employee@example.com"])
  expect(delegateEmployeePermissions).not.toHaveBeenCalled()
})
/**
 * Builds a delegation request with only workflow-right overrides.
 * @param permissions - Proposed employee-control changes.
 * @returns Request containing the validated target identity and changes.
 */
function request(permissions:Record<string,boolean>):Request {
  return new Request("http://localhost/tanovo-time/api/delegation",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"employee@example.com",permissions})})
}
it("delegates approval while preserving the employee role",async()=>{
  expect((await PATCH(request({review_entries:true}))).status).toBe(200)
  expect(delegateEmployeePermissions).toHaveBeenCalledWith("employee@example.com","employee",{review_entries:true},"manager@example.com")
})
it("cannot delegate delegation authority",async()=>{
  expect((await PATCH(request({delegate_permissions:true}))).status).toBe(403)
  expect(delegateEmployeePermissions).not.toHaveBeenCalled()
})
it("cannot grant rights revoked from the manager",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{review_entries:false})})
  expect((await PATCH(request({review_entries:true}))).status).toBe(403)
  expect(delegateEmployeePermissions).not.toHaveBeenCalled()
})
