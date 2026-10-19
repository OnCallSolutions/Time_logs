import { beforeEach,expect,it,vi } from "vitest"

vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn()}))
vi.mock("@/lib/db",()=>({listManagerWorkforceEmails:vi.fn()}))

import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster } from "@/lib/collaboration"
import { listManagerWorkforceEmails } from "@/lib/db"
import { GET } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{view_team:true}} as never)
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["assigned@example.com"])
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"assigned@example.com",displayName:"Assigned Worker",role:"employee",accessStatus:"active",contractorNumber:null},
    {email:"other@example.com",displayName:"Other Worker",role:"contractor",accessStatus:"active",contractorNumber:"TN-02"},
    {email:"inactive@example.com",displayName:"Former Worker",role:"contractor",accessStatus:"suspended",contractorNumber:"TN-03"},
    {email:"peer@example.com",displayName:"Another Manager",role:"manager",accessStatus:"active",contractorNumber:null},
  ] as never)
})

it("returns only active employees and contractors assigned to the signed-in manager",async()=>{
  const response=await GET()
  expect(response.status).toBe(200)
  expect(listManagerWorkforceEmails).toHaveBeenCalledWith("manager@example.com")
  expect(await response.json()).toEqual({people:[{email:"assigned@example.com",displayName:"Assigned Worker",role:"employee",contractorNumber:null}]})
  expect(response.headers.get("cache-control")).toBe("no-store")
})

it("keeps the manager directory available when broad team-entry visibility is revoked",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{view_team:false}} as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({people:[{email:"assigned@example.com",displayName:"Assigned Worker",role:"employee",contractorNumber:null}]})
  expect(listManagerWorkforceEmails).toHaveBeenCalledWith("manager@example.com")
})

it("denies non-managers",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:{view_team:true}} as never)
  expect((await GET()).status).toBe(403)
  expect(actorRoster).not.toHaveBeenCalled()
})
