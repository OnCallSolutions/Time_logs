/**
 * Tests temporary rights without reviving blocked accounts or bypassing denials.
 * Grantor authority is reevaluated on every resolution, not just on creation.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({getManagedAccessUser:vi.fn()}))
vi.mock("@/lib/access-lifecycle-store",()=>({getTemporaryAssignments:vi.fn()}))
import { getEffectiveUserRole } from "./access"
import { getManagedAccessUser } from "./db"
import { getTemporaryAssignments } from "./access-lifecycle-store"
import { getEffectivePermissions } from "./effective-permissions"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="manager@example.com"?"manager":"employee")
  vi.mocked(getManagedAccessUser).mockResolvedValue(null)
  vi.mocked(getTemporaryAssignments).mockResolvedValue([{id:"grant",email:"staff@example.com",permissions:["review_entries"],scope:"all",startsAt:"2020-01-01T00:00:00Z",endsAt:"2099-01-01T00:00:00Z",grantedBy:"manager@example.com",reason:"Coverage",revokedAt:null}])
})
it("adds an active operational grant without changing the primary role",async()=>{
  const access=await getEffectivePermissions("staff@example.com")
  expect(access.role).toBe("employee");expect(access.permissions.review_entries).toBe(true)
})
it("retains explicit permanent denial over temporary grants",async()=>{
  vi.mocked(getManagedAccessUser).mockImplementation(async email=>email==="staff@example.com"?{permissions:{review_entries:false}} as never:null)
  expect((await getEffectivePermissions("staff@example.com")).permissions.review_entries).toBe(false)
})
it("withdraws grants when their author loses account access",async()=>{
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="manager@example.com"?null:"employee")
  expect((await getEffectivePermissions("staff@example.com")).permissions.review_entries).toBe(false)
})
it("does not load temporary grants for an inactive target",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue(null)
  const access=await getEffectivePermissions("staff@example.com")
  expect(access.role).toBeNull();expect(access.permissions.review_entries).toBe(false)
  expect(getTemporaryAssignments).not.toHaveBeenCalled()
})
