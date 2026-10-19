/** Protects period configuration and validates calendar ranges before persistence. */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/timesheet-periods",requestId:null}))}))
vi.mock("@/lib/db",()=>({createTimesheetPeriod:vi.fn(),ensureDefaultUpcomingTimesheetPeriod:vi.fn(),listTimesheetPeriods:vi.fn(),updateTimesheetPeriod:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {createTimesheetPeriod,ensureDefaultUpcomingTimesheetPeriod,listTimesheetPeriods,updateTimesheetPeriod} from "@/lib/db"
import {GET,PATCH,POST} from "./route"

const payload={name:"October 2026",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-05T17:00:00.000Z",managerGraceDays:3,reminderDays:3}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{manage_timesheet_periods:true}} as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([])
  vi.mocked(createTimesheetPeriod).mockResolvedValue({id:"period",...payload,submissionDeadline:payload.submissionDeadline,createdBy:"admin@example.com",createdAt:"2026-10-17T00:00:00.000Z"})
  vi.mocked(updateTimesheetPeriod).mockResolvedValue({id:"period",...payload,submissionDeadline:payload.submissionDeadline,createdBy:"admin@example.com",createdAt:"2026-10-17T00:00:00.000Z"})
})
it("lets signed-in actors view configured periods without scheduling for patrons",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  expect((await GET(new Request("http://localhost/api/timesheet-periods"))).status).toBe(200)
  expect(ensureDefaultUpcomingTimesheetPeriod).not.toHaveBeenCalled()
})
it("checks for an expired period and audits a default successor for authorized period managers",async()=>{
  const response=await GET(new Request("http://localhost/api/timesheet-periods"))
  expect(response.status).toBe(200)
  expect(ensureDefaultUpcomingTimesheetPeriod).toHaveBeenCalledWith(expect.objectContaining({requestPath:"/api/timesheet-periods"}))
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
  expect(createTimesheetPeriod).toHaveBeenCalledWith(expect.objectContaining({...payload,timezone:"America/New_York"}),"admin@example.com",expect.anything())
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
  expect(createTimesheetPeriod).toHaveBeenCalledWith(expect.objectContaining({...payload,timezone:"America/New_York"}),"admin@example.com",expect.anything())
})
it("rejects inverted date ranges",async()=>{
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify({...payload,startDate:"2026-11-01",endDate:"2026-10-01"})}))
  expect(response.status).toBe(400)
  expect(createTimesheetPeriod).not.toHaveBeenCalled()
})
it("rejects creation of a period whose end date is in the past",async()=>{
  const response=await POST(new Request("http://localhost/api/timesheet-periods",{method:"POST",body:JSON.stringify({...payload,startDate:"2020-01-01",endDate:"2020-01-31"})}))
  expect(response.status).toBe(400)
  expect(createTimesheetPeriod).not.toHaveBeenCalled()
})
it("allows an authorized account manager to apply a reasoned period override",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{manage_timesheet_periods:true}} as never)
  const response=await PATCH(new Request("http://localhost/api/timesheet-periods",{method:"PATCH",body:JSON.stringify({id:"123e4567-e89b-42d3-a456-426614174000",...payload,submissionDeadline:"2026-10-10T17:00:00.000Z",reason:"Approved extension"})}))
  expect(response.status).toBe(200)
  expect(updateTimesheetPeriod).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000",expect.objectContaining({submissionDeadline:"2026-10-10T17:00:00.000Z"}),"admin@example.com","Approved extension",expect.anything())
})
it("requires period-management rights and a reason for period overrides",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{manage_timesheet_periods:false}} as never)
  const body={id:"123e4567-e89b-42d3-a456-426614174000",...payload,reason:"Approved extension"}
  expect((await PATCH(new Request("http://localhost/api/timesheet-periods",{method:"PATCH",body:JSON.stringify(body)}))).status).toBe(403)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{manage_timesheet_periods:true}} as never)
  expect((await PATCH(new Request("http://localhost/api/timesheet-periods",{method:"PATCH",body:JSON.stringify({...body,reason:"no"})}))).status).toBe(400)
  expect(updateTimesheetPeriod).not.toHaveBeenCalled()
})
it("prevents edits to periods that have already ended",async()=>{
  const response=await PATCH(new Request("http://localhost/api/timesheet-periods",{method:"PATCH",body:JSON.stringify({id:"123e4567-e89b-42d3-a456-426614174000",...payload,startDate:"2020-01-01",endDate:"2020-01-31",reason:"Correct historical dates"})}))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({error:"Past periods are archived and cannot be edited."})
  expect(updateTimesheetPeriod).not.toHaveBeenCalled()
})
