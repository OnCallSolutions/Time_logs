import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/submission-extensions",requestId:null}))}))
vi.mock("@/lib/persistence-diagnostics",()=>({persistenceFailureDetails:vi.fn(()=>({}))}))
vi.mock("@/lib/db",()=>({createTimesheetExtensionRequest:vi.fn(),listTimesheetExtensionRequests:vi.fn(),listTimesheetPeriods:vi.fn(),decideTimesheetExtensionRequest:vi.fn()}))
vi.mock("@/lib/submission-reviewer",()=>({resolveAccountManagerReviewer:vi.fn(),resolvePatronManager:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {createTimesheetExtensionRequest,listTimesheetExtensionRequests,listTimesheetPeriods,decideTimesheetExtensionRequest} from "@/lib/db"
import {resolveAccountManagerReviewer,resolvePatronManager} from "@/lib/submission-reviewer"
import {GET,POST} from "./route"
import {PATCH} from "./[id]/route"

const input={periodId:"123e4567-e89b-42d3-a456-426614174000",reason:"A documented client delay",requestedUntil:new Date(Date.now()+3*86_400_000).toISOString()}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"patron@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{submit_entries:true}} as never)
  vi.mocked(resolveAccountManagerReviewer).mockResolvedValue({email:"accounts@example.com",displayName:"Accounts",assignment:"available_manager"})
  vi.mocked(resolvePatronManager).mockResolvedValue({email:"manager@example.com",displayName:"Manager"})
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:input.periodId,name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:new Date(Date.now()+86_400_000).toISOString(),managerSubmissionDeadline:new Date(Date.now()+5*86_400_000).toISOString(),accountApprovalDeadline:new Date(Date.now()+10*86_400_000).toISOString(),managerGraceDays:10,reminderDays:3,createdBy:"accounts@example.com",createdAt:new Date().toISOString()}])
  vi.mocked(createTimesheetExtensionRequest).mockResolvedValue({id:"request",requesterEmail:"patron@example.com",requesterName:"Patron",periodId:input.periodId,periodName:"October",assignedTo:"accounts@example.com",reason:input.reason,requestedUntil:input.requestedUntil,status:"pending",reviewedBy:null,reviewedAt:null,managerNote:"",approvedUntil:null,createdAt:input.requestedUntil})
  vi.mocked(listTimesheetExtensionRequests).mockResolvedValue([])
  vi.mocked(decideTimesheetExtensionRequest).mockResolvedValue(null)
})

it.each(["employee","contractor","manager"] as const)("routes %s extension requests to the correct approval layer",async role=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role,permissions:{submit_entries:true}} as never)
  const body=role==="manager"?{...input,requestedUntil:new Date(Date.now()+7*86_400_000).toISOString()}:input
  const response=await POST(new Request("http://localhost/api/submission-extensions",{method:"POST",body:JSON.stringify(body)}))
  expect(response.status).toBe(201)
  expect(createTimesheetExtensionRequest).toHaveBeenCalledWith(expect.objectContaining({ownerEmail:"patron@example.com",assignedTo:role==="manager"?"accounts@example.com":"manager@example.com",periodId:input.periodId}),expect.anything())
})

it("denies requests from roles without patron submission access",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{submit_entries:true}} as never)
  expect((await POST(new Request("http://localhost/api/submission-extensions",{method:"POST",body:JSON.stringify(input)}))).status).toBe(403)
  expect(createTimesheetExtensionRequest).not.toHaveBeenCalled()
})

it("requires an active authorized account manager to receive the request",async()=>{
  vi.mocked(resolvePatronManager).mockResolvedValue(null)
  expect((await POST(new Request("http://localhost/api/submission-extensions",{method:"POST",body:JSON.stringify(input)}))).status).toBe(409)
  expect(createTimesheetExtensionRequest).not.toHaveBeenCalled()
})

it("rejects extension requests beyond the account-manager-configured grace limit",async()=>{
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:input.periodId,name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:new Date(Date.now()+86_400_000).toISOString(),managerSubmissionDeadline:new Date(Date.now()+2*86_400_000).toISOString(),accountApprovalDeadline:new Date(Date.now()+10*86_400_000).toISOString(),managerGraceDays:2,reminderDays:3,createdBy:"accounts@example.com",createdAt:new Date().toISOString()}])
  const response=await POST(new Request("http://localhost/api/submission-extensions",{method:"POST",body:JSON.stringify({...input,requestedUntil:new Date(Date.now()+7*86_400_000).toISOString()})}))
  expect(response.status).toBe(400)
  expect(createTimesheetExtensionRequest).not.toHaveBeenCalled()
})

it("returns only requests in the signed-in patron or assigned account manager scope",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{review_entries:true}} as never)
  expect((await GET()).status).toBe(200)
  expect(listTimesheetExtensionRequests).toHaveBeenCalledWith("accounts@example.com",true,false)
})

it("requires account-manager review rights to approve a request",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{review_entries:false}} as never)
  const response=await PATCH(new Request("http://localhost/api/submission-extensions/request-id",{method:"PATCH",body:JSON.stringify({decision:"approved",managerNote:"Not authorized",approvedUntil:input.requestedUntil})}),{params:Promise.resolve({id:input.periodId})})
  expect(response.status).toBe(403)
  expect(decideTimesheetExtensionRequest).not.toHaveBeenCalled()
})

it("lets the assigned account manager make a decision",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:{review_entries:true}} as never)
  vi.mocked(decideTimesheetExtensionRequest).mockResolvedValue({id:"request"} as never)
  const response=await PATCH(new Request("http://localhost/api/submission-extensions/request-id",{method:"PATCH",body:JSON.stringify({decision:"approved",managerNote:"Approved for delay",approvedUntil:input.requestedUntil})}),{params:Promise.resolve({id:input.periodId})})
  expect(response.status).toBe(200)
  expect(decideTimesheetExtensionRequest).toHaveBeenCalledWith(input.periodId,"accounts@example.com","approved","Approved for delay",input.requestedUntil,false,expect.anything())
})
