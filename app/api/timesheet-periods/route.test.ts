/** Protects period configuration and validates calendar ranges before persistence. */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/timesheet-periods",requestId:null}))}))
vi.mock("@/lib/db",()=>({createTimesheetPeriod:vi.fn(),listTimesheetPeriods:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {createTimesheetPeriod,listTimesheetPeriods} from "@/lib/db"
import {GET,POST} from "./route"

const payload={name:"October 2026",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-05T17:00:00.000Z",managerGraceDays:3,reminderDays:3}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{manage_timesheet_periods:true}} as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([])
  vi.mocked(createTimesheetPeriod).mockResolvedValue({id:"period",...payload,submissionDeadline:payload.submissionDeadline,createdBy:"admin@example.com",createdAt:"2026-10-17T00:00:00.000Z"})
})
it("lets signed-in actors view configured periods",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  expect((await GET()).status).toBe(200)
})
it("requires explicit period-management rights to create a period",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{}} as never)
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify(payload)}))
  expect(response.status).toBe(403)
  expect(createTimesheetPeriod).not.toHaveBeenCalled()
})
it("allows account managers with the period-management right to create periods",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{manage_timesheet_periods:true}} as never)
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify(payload)}))
  expect(response.status).toBe(201)
  expect(createTimesheetPeriod).toHaveBeenCalledWith(payload,"admin@example.com",expect.anything())
})
it("does not allow account managers whose period-management right was revoked",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{manage_timesheet_periods:false}} as never)
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify(payload)}))
  expect(response.status).toBe(403)
  expect(createTimesheetPeriod).not.toHaveBeenCalled()
})
it("creates a valid non-overlapping period with manager grace and reminder lead",async()=>{
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify(payload)}))
  expect(response.status).toBe(201)
  expect(createTimesheetPeriod).toHaveBeenCalledWith(payload,"admin@example.com",expect.anything())
})
it("rejects inverted date ranges",async()=>{
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify({...payload,startDate:"2026-11-01",endDate:"2026-10-01"})}))
  expect(response.status).toBe(400)
  expect(createTimesheetPeriod).not.toHaveBeenCalled()
})
