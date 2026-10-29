import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({listEntryRejections:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listEntryRejections } from "@/lib/db"
import { GET } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{review_entries:true}} as never)
  vi.mocked(listEntryRejections).mockResolvedValue([])
})

it("scopes manager rejection history to that manager's own decisions",async()=>{
  expect((await GET()).status).toBe(200)
  expect(listEntryRejections).toHaveBeenCalledWith("manager@example.com")
})

it("lets admins access the complete rejection archive",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{}} as never)
  expect((await GET()).status).toBe(200)
  expect(listEntryRejections).toHaveBeenCalledWith(null)
})

it("denies patrons without review rights",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{review_entries:false,review_other_manager_entries:false}} as never)
  expect((await GET()).status).toBe(403)
  expect(listEntryRejections).not.toHaveBeenCalled()
})
