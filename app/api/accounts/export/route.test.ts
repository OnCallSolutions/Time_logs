import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({listHandoffs:vi.fn()}))
vi.mock("@/lib/db",()=>({listTimesheetPeriods:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listHandoffs } from "@/lib/account-handoffs"
import { listTimesheetPeriods } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { GET } from "./route"

const snapshots=[
  {id:"handoff-1",entry_id:"entry-1",current:true,review_state:"pending",review_note:"",review_version:0,evidence:{contractor:"Contractor One",ownerEmail:"one@example.com",workerCategory:"contractor",date:"2026-10-09",hours:4,project:"Build",description:"Implementation",reviewedBy:"manager@example.com",reviewedAt:"2026-10-10T12:00:00.000Z"}},
  {id:"handoff-2",entry_id:"entry-2",current:true,review_state:"ready_for_finance",review_note:"Checked",review_version:1,evidence:{contractor:"Staff Two",ownerEmail:"two@example.com",workerCategory:"employee",date:"2026-09-20",hours:6,project:"Support",description:"Support work",reviewedBy:"other@example.com",reviewedAt:"2026-09-21T12:00:00.000Z"}},
]
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager")} as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"october",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2026-11-02T17:00:00.000Z"}] as never)
  vi.mocked(listHandoffs).mockResolvedValue(snapshots as never)
})

it("returns a versioned JSON export scoped to selected period and approving manager",async()=>{
  const response=await GET(new Request("http://localhost/api/accounts/export?periodId=october&manager=manager%40example.com&workerCategory=contractor&worker=contractor%20one&search=implementation&state=pending&sort=oldest"))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(response.headers.get("content-disposition")).toContain("approved-timesheets")
  expect(await response.json()).toMatchObject({schema:"tanovo-time.approved-timesheets/v1",period:{id:"october",name:"October"},filters:{workerCategory:"contractor",worker:"contractor one",search:"implementation",state:"pending",sort:"oldest"},count:1,totalApprovedHours:4,records:[{person:"Contractor One",approvedBy:"manager@example.com",approvedHours:4,periodId:"october"}]})
})

it("does not export evidence when account visibility is revoked",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:false})} as never)
  expect((await GET(new Request("http://localhost/api/accounts/export"))).status).toBe(403)
  expect(listHandoffs).not.toHaveBeenCalled()
})
