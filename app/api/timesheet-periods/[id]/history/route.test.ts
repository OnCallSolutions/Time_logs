import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({listTimesheetPeriodAuditHistory:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {listTimesheetPeriodAuditHistory} from "@/lib/db"
import {GET} from "./route"

const params=Promise.resolve({id:"123e4567-e89b-42d3-a456-426614174000"})
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{manage_timesheet_periods:true}} as never)
  vi.mocked(listTimesheetPeriodAuditHistory).mockResolvedValue([])
})

it("returns period history to authorized period managers",async()=>{
  const response=await GET(new Request("http://localhost/api/timesheet-periods/123e4567-e89b-42d3-a456-426614174000/history"),{params})
  expect(response.status).toBe(200)
  expect(listTimesheetPeriodAuditHistory).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000")
})

it("does not disclose period history without period-management permission",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{manage_timesheet_periods:false}} as never)
  const response=await GET(new Request("http://localhost/api/timesheet-periods/123e4567-e89b-42d3-a456-426614174000/history"),{params})
  expect(response.status).toBe(403)
  expect(listTimesheetPeriodAuditHistory).not.toHaveBeenCalled()
})

it("rejects invalid period identifiers",async()=>{
  const response=await GET(new Request("http://localhost/api/timesheet-periods/not-a-uuid/history"),{params:Promise.resolve({id:"not-a-uuid"})})
  expect(response.status).toBe(400)
  expect(listTimesheetPeriodAuditHistory).not.toHaveBeenCalled()
})
