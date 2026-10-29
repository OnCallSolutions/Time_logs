import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({listAccountApprovedEntryIds:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAccountApprovedEntryIds } from "@/lib/account-handoffs"
import { GET } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{view_accounts:true,review_entries:true}} as never)
  vi.mocked(listAccountApprovedEntryIds).mockResolvedValue(["entry-final"])
})

it("returns only the authenticated account manager's persisted final-approval IDs",async()=>{
  const response=await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({entryIds:["entry-final"]})
  expect(listAccountApprovedEntryIds).toHaveBeenCalledWith("accounts@example.com",false)
})

it("denies users without final approval rights",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{view_accounts:true,review_entries:true}} as never)
  const response=await GET()
  expect(response.status).toBe(403)
  expect(listAccountApprovedEntryIds).not.toHaveBeenCalled()
})
