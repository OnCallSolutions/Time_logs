/**
 * Verifies delegated rights cannot exceed manager authority or promote accounts.
 * Uses isolated database mocks to avoid changing real employee assignments.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn(),delegateEmployeePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({employeeRoster:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { employeeRoster } from "@/lib/collaboration"
import { delegateEmployeePermissions } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { PATCH } from "./route"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(employeeRoster).mockResolvedValue([{email:"employee@example.com",role:"employee"}])
  vi.mocked(delegateEmployeePermissions).mockResolvedValue({email:"employee@example.com",role:"employee"} as never)
})
/**
 * Builds a delegation request with only workflow-right overrides.
 * @param permissions - Proposed employee-control changes.
 * @returns Request containing the validated target identity and changes.
 */
function request(permissions:Record<string,boolean>):Request {
  return new Request("http://localhost/timelog/api/delegation",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"employee@example.com",permissions})})
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
