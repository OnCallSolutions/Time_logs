import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({requestMethod:"PATCH",requestPath:"/api/accounts/correct-entry"}))}))
vi.mock("@/lib/account-handoffs",()=>({correctReopenedTimesheetEntry:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { correctReopenedTimesheetEntry } from "@/lib/account-handoffs"
import { PATCH } from "./route"

const input={id:"123e4567-e89b-42d3-a456-426614174001",periodId:"123e4567-e89b-42d3-a456-426614174000",revision:"2026-10-27T12:00:00.000Z",project:"Field operations",date:"2026-10-26",hours:3,description:"Corrected site visit record",reason:"Correct the project and recorded time"}
const request=(body=input)=>new Request("http://localhost/api/accounts/correct-entry",{method:"PATCH",body:JSON.stringify(body)})

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{view_accounts:true,review_entries:true}} as never)
  vi.mocked(correctReopenedTimesheetEntry).mockResolvedValue(true)
})

it("allows a scoped account manager to correct a recalled entry with a recorded reason",async()=>{
  const response=await PATCH(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({updated:true})
  expect(correctReopenedTimesheetEntry).toHaveBeenCalledWith(input,"accounts@example.com",expect.anything(),false)
})

it("rejects entry corrections from users without account review rights",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{view_accounts:true,review_entries:true}} as never)
  expect((await PATCH(request())).status).toBe(403)
  expect(correctReopenedTimesheetEntry).not.toHaveBeenCalled()
})

it("rejects invalid edit payloads",async()=>{
  expect((await PATCH(request({...input,hours:30}))).status).toBe(400)
  expect(correctReopenedTimesheetEntry).not.toHaveBeenCalled()
})
