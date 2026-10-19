import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/timesheets/reopen-approval",requestId:null}))}))
vi.mock("@/lib/account-handoffs",()=>({reopenApprovedTimesheet:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { reopenApprovedTimesheet } from "@/lib/account-handoffs"
import { POST } from "./route"

const input={ownerEmail:"patron@example.com",periodId:"123e4567-e89b-42d3-a456-426614174000",startDate:"2026-10-24",endDate:"2026-10-30",reason:"Correct the project allocation",selection:[{id:"123e4567-e89b-42d3-a456-426614174001",revision:"2026-10-27T12:00:00.000Z"}]}
const request=()=>new Request("http://localhost/api/timesheets/reopen-approval",{method:"POST",body:JSON.stringify(input)})

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{view_accounts:true,review_entries:true}} as never)
  vi.mocked(reopenApprovedTimesheet).mockResolvedValue([{id:input.selection[0].id,status:"submitted"}] as never)
})

it("only reopens a complete final-approved batch for an authorized account manager",async()=>{
  const response=await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({destination:"approval_queue"})
  expect(reopenApprovedTimesheet).toHaveBeenCalledWith(expect.objectContaining({ownerEmail:input.ownerEmail,periodId:input.periodId,reason:input.reason}),"accounts@example.com",expect.anything(),false)
})

it("does not allow an account manager without final-approval rights to reopen a batch",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{view_accounts:true,review_entries:false}} as never)
  const response=await POST(request())
  expect(response.status).toBe(403)
  expect(reopenApprovedTimesheet).not.toHaveBeenCalled()
})

it("rejects incomplete or invalid timesheet selections before persistence",async()=>{
  const response=await POST(new Request("http://localhost/api/timesheets/reopen-approval",{method:"POST",body:JSON.stringify({...input,reason:"no"})}))
  expect(response.status).toBe(400)
  expect(reopenApprovedTimesheet).not.toHaveBeenCalled()
})
