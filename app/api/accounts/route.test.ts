/**
 * Exercises administrator-granted account handoff boundaries with mocked storage.
 * Tests prevent employee work, inactive assignees, and missing rights from entering
 * the business-account queue. No live financial or database operation is invoked.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),listTimeEntries:vi.fn(),listTimesheetPeriods:vi.fn().mockResolvedValue([]),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({createHandoffs:vi.fn(),listHandoffs:vi.fn(),reviewHandoff:vi.fn(),actOnHandoffs:vi.fn(),accountTriageStates:["pending","needs_information","ready_for_finance","archived"]}))
import { actorRoster } from "@/lib/collaboration"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry,listTimesheetPeriods } from "@/lib/db"
import { listAccountIdentities } from "@/lib/account-identities"
import { createHandoffs,listHandoffs,reviewHandoff,actOnHandoffs } from "@/lib/account-handoffs"
import { resolvePermissions } from "@/lib/permissions"
import { GET,POST,PATCH } from "./route"
const id="123e4567-e89b-42d3-a456-426614174000"
/** @returns An explicit handoff request, with no trusted identity supplied by the client. */
function request(){return new Request("http://localhost/tanovo-time/api/accounts",{method:"POST",body:JSON.stringify({ids:[id],recipient:"accounts@example.com"})})}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(actorRoster).mockResolvedValue([])
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_to_accounts:true})})
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="accounts@example.com"?"account_manager":"contractor")
  vi.mocked(getTimeEntry).mockResolvedValue({id,status:"approved",ownerEmail:"supplier@example.com"} as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([{email:"supplier@example.com"}] as never)
  vi.mocked(createHandoffs).mockResolvedValue([{id,entry_id:id}])
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"period-1",name:"October 2026",startDate:"2026-10-01",endDate:"2026-10-31"}] as never)
})
it("respects an administrator-denied handoff permission",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_to_accounts:false})})
  expect((await POST(request())).status).toBe(403)
  expect(createHandoffs).not.toHaveBeenCalled()
})
it("labels internal employee handoffs separately from contractors",async()=>{
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="accounts@example.com"?"account_manager":"employee")
  expect((await POST(request())).status).toBe(201)
  expect(createHandoffs).toHaveBeenCalledWith([id],"manager@example.com","accounts@example.com",true,{[id]:"employee"})
})
it("refuses an inactive or non-account-manager assignee",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue(null)
  expect((await POST(request())).status).toBe(400)
  expect(createHandoffs).not.toHaveBeenCalled()
})
it("passes only authenticated handoff identity and server visibility",async()=>{
  expect((await POST(request())).status).toBe(201)
  expect(createHandoffs).toHaveBeenCalledWith([id],"manager@example.com","accounts@example.com",true,{[id]:"contractor"})
})
it("does not hand off approved time for an account without a registered company identity",async()=>{
  vi.mocked(listAccountIdentities).mockResolvedValue([])
  const response=await POST(request())
  expect(response.status).toBe(409)
  expect(createHandoffs).not.toHaveBeenCalled()
})
it("requires separate account triage rights even when queue visibility exists",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:false})})
  expect((await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({id,state:"needs_information",note:"Check evidence",version:0})}))).status).toBe(403)
  expect(reviewHandoff).not.toHaveBeenCalled()
})
it("reports a conflict rather than accepting stale account-review evidence",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  vi.mocked(reviewHandoff).mockResolvedValue(null)
  expect((await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({id,state:"ready_for_finance",note:"Reviewed evidence",version:0})}))).status).toBe(409)
})
it("allows authorized business accounts to inspect the shared queue",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  vi.mocked(listHandoffs).mockResolvedValue([])
  const response=await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({periods:[{id:"period-1",name:"October 2026"}],handoffs:[]})
  expect(listHandoffs).toHaveBeenCalledWith("accounts@example.com",false)
  expect(listTimesheetPeriods).toHaveBeenCalledOnce()
})
it("returns contractor timesheets directly to the contractor with a bounded correction deadline",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  const row={id,review_version:2,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}}
  vi.mocked(listHandoffs).mockResolvedValue([row] as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"p",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}] as never)
  vi.mocked(actOnHandoffs).mockResolvedValue(1)
  const response=await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({action:"return_submitter",selection:[{id,version:2,reject:true}],note:"Correct the evidence",correctionDueAt:"2099-11-05T17:00:00.000Z"})}))
  expect(response.status).toBe(200)
  expect(actOnHandoffs).toHaveBeenCalledWith([{id,version:2,reject:true}],"accounts@example.com","return_submitter","Correct the evidence",{accuracy:false,compliance:false,housekeeping:false},null,expect.anything(),"2099-11-05T17:00:00.000Z")
})
it("requires exactly one flagged entry when returning a full timesheet batch",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  const secondId="123e4567-e89b-42d3-a456-426614174002"
  const batch=[id,secondId].map(entryId=>({id:entryId,review_version:1,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}}))
  vi.mocked(listHandoffs).mockResolvedValue(batch as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"p",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}] as never)
  vi.mocked(actOnHandoffs).mockResolvedValue(2)
  const response=await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({action:"return_submitter",selection:[{id,version:1,reject:true},{id:secondId,version:1,reject:false}],note:"Please correct",correctionDueAt:"2099-11-05T17:00:00.000Z"})}))
  expect(response.status).toBe(200)
  expect(actOnHandoffs).toHaveBeenCalledWith([{id,version:1,reject:true},{id:secondId,version:1,reject:false}],"accounts@example.com","return_submitter","Please correct",{accuracy:false,compliance:false,housekeeping:false},null,expect.anything(),"2099-11-05T17:00:00.000Z")
})
it("allows an account manager to finalize a complete manager-approved timesheet batch",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true,review_entries:true})})
  vi.mocked(listHandoffs).mockResolvedValue([{id,review_version:3,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}}] as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"p",name:"October",startDate:"2026-10-01",endDate:"2026-10-31"}] as never)
  vi.mocked(actOnHandoffs).mockResolvedValue(1)
  const response=await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({action:"approve_timesheets",selection:[{id,version:3}],note:"Final account review complete"})}))
  expect(response.status).toBe(200)
  expect(actOnHandoffs).toHaveBeenCalledWith([{id,version:3}],"accounts@example.com","approve_timesheets","Final account review complete",{accuracy:false,compliance:false,housekeeping:false},null,expect.anything(),undefined)
})
it("rejects a partial timesheet selection before mutation",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  const secondId="123e4567-e89b-42d3-a456-426614174002"
  vi.mocked(listHandoffs).mockResolvedValue([{id,review_version:1,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}},{id:secondId,review_version:1,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}}] as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"p",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}] as never)
  const response=await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({action:"return_submitter",selection:[{id,version:1,reject:true}],note:"Please correct",correctionDueAt:"2099-11-05T17:00:00.000Z"})}))
  expect(response.status).toBe(409)
  expect(actOnHandoffs).not.toHaveBeenCalled()
})
it("rejects account returns beyond a selected period's resolution deadline",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  vi.mocked(listHandoffs).mockResolvedValue([{id,review_version:2,current:true,review_state:"pending",evidence:{ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-10"}}] as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"p",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}] as never)
  const response=await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({action:"return_submitter",selection:[{id,version:2,reject:true}],note:"Correct the evidence",correctionDueAt:"2099-11-06T12:01:00.000Z"})}))
  expect(response.status).toBe(422)
  expect(actOnHandoffs).not.toHaveBeenCalled()
})
