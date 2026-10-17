/**
 * Tests reviewer separation against authenticated identities and server-loaded ownership.
 * Own-record decisions must never reach database mutation or audit helpers.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),getTimesheetSubmissionDeadline:vi.fn(async()=>null),updateTimeEntryWithAudit:vi.fn(),submitTimeEntryWithAudit:vi.fn(),rejectSubmittedEntry:vi.fn(),deleteTimeEntry:vi.fn(),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/review-requests",()=>({listReviewRequests:vi.fn(async()=>[])}))
vi.mock("@/lib/account-handoffs",()=>({approveAndForward:vi.fn()}))
vi.mock("@/lib/submission-reviewer",()=>({resolveSubmissionReviewer:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry,getTimesheetSubmissionDeadline,updateTimeEntryWithAudit,submitTimeEntryWithAudit,deleteTimeEntry,rejectSubmittedEntry } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { PATCH,DELETE } from "./route"
import { approveAndForward } from "@/lib/account-handoffs"
import { listAccountIdentities } from "@/lib/account-identities"
import { resolveSubmissionReviewer } from "@/lib/submission-reviewer"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"submitted"} as never)
  vi.mocked(approveAndForward).mockResolvedValue({id:"entry",status:"approved"} as never)
  vi.mocked(resolveSubmissionReviewer).mockResolvedValue({email:"manager@example.com",displayName:"Morgan Manager",assignment:"added_by_manager"})
  vi.mocked(listAccountIdentities).mockImplementation(async emails=>emails?.length?[{email:emails[0]}] as never:[] as never)
})
it("assigns the server-resolved manager and rejects submitter attempts to reroute",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"draft",revision:"original"} as never)
  vi.mocked(updateTimeEntryWithAudit).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",reviewManagerEmail:"manager@example.com"} as never)
  vi.mocked(submitTimeEntryWithAudit).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",reviewManagerEmail:"manager@example.com"} as never)

  const blocked=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"submitted",reviewManagerEmail:"other-manager@example.com"})}),{params:Promise.resolve({id:"entry"})})
  expect(blocked.status).toBe(403)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()

  const submitted=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"submitted",expectedRevision:"original"})}),{params:Promise.resolve({id:"entry"})})
  expect(submitted.status).toBe(200)
  expect(submitTimeEntryWithAudit).toHaveBeenCalledWith("contractor@example.com","entry",expect.objectContaining({status:"submitted",reviewManagerEmail:"manager@example.com"}),false,undefined,"original","contractor@example.com","draft",expect.objectContaining({changedFields:expect.any(Array)}),"contractor",expect.anything())
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("does not report a successful submission when the atomic update did not commit",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"draft",revision:"original"} as never)
  vi.mocked(submitTimeEntryWithAudit).mockResolvedValue(null)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"submitted",expectedRevision:"original"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect((await response.json()).error).toMatch(/Evidence changed/)
})
it("lets an owner recall submitted evidence before approval",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",revision:"current"} as never)
  vi.mocked(updateTimeEntryWithAudit).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"draft"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"draft",expectedRevision:"current"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
  expect((await response.json()).entry.status).toBe("draft")
  expect(updateTimeEntryWithAudit).toHaveBeenCalledWith("contractor@example.com","entry",expect.objectContaining({status:"draft"}),false,undefined,"current",expect.objectContaining({actorEmail:"contractor@example.com",action:"entry_recalled"}))
})
it("does not allow an owner to recall after approval",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"approved",revision:"current"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"draft",expectedRevision:"current"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("blocks submission at the organization deadline",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"draft",revision:"current"} as never)
  vi.mocked(getTimesheetSubmissionDeadline).mockResolvedValue("2020-01-01T00:00:00.000Z")
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"submitted",expectedRevision:"current"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect((await response.json()).error).toMatch(/deadline passed/i)
  expect(submitTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("rejects manager-to-manager approval",async()=>{
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(404);expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("permits an explicitly authorized account manager to review manager work",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted",revision:"original"} as never)
  vi.mocked(updateTimeEntryWithAudit).mockResolvedValue({id:"entry",status:"approved"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
})
it("lets the assigned account manager approve employee work under their authenticated identity",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager")})
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",reviewManagerEmail:"accounts@example.com",status:"submitted",revision:"original"} as never)
  vi.mocked(approveAndForward).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",status:"approved"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved",expectedRevision:"original"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
  expect(approveAndForward).toHaveBeenCalledWith("entry","accounts@example.com","original","employee",expect.anything())
})
it("blocks self-approval even for a reviewer with team access",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("blocks self-rejection rather than letting reviewers moderate their own evidence",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"rejected",reviewNote:"Reason"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("locks a manager's own submitted evidence against editing",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({hours:12})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("locks a manager's own submitted evidence against deletion",async()=>{
  const response=await DELETE(new Request("http://localhost/api/entries/entry",{method:"DELETE"}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(deleteTimeEntry).not.toHaveBeenCalled()
})
it("does not let managers delete another person's entries even with delete rights",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",reviewManagerEmail:"manager@example.com",status:"submitted"} as never)
  const response=await DELETE(new Request("http://localhost/api/entries/entry",{method:"DELETE"}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect((await response.json()).error).toMatch(/Reject it with a reason/)
  expect(deleteTimeEntry).not.toHaveBeenCalled()
})
it("preserves administrator deletion access for another person's unprotected entry",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",status:"submitted"} as never)
  const response=await DELETE(new Request("http://localhost/api/entries/entry",{method:"DELETE"}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
  expect(deleteTimeEntry).toHaveBeenCalledWith("manager@example.com","entry",true)
})
it("does not let manager privileges reopen their own approved time",async()=>{
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"approved"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"draft"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("rejects revision-only patches without touching evidence",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({expectedRevision:"2026-10-10 00:00:00+00"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(400);expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("returns conflict when the expected evidence revision no longer matches",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
  vi.mocked(updateTimeEntryWithAudit).mockResolvedValue(null)
  vi.mocked(approveAndForward).mockResolvedValue(null)
  const revision="2026-10-10 00:00:00.123456+00"
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved",expectedRevision:revision})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(approveAndForward).toHaveBeenCalledWith("entry","manager@example.com",revision,"manager",expect.anything())
})

it("does not approve or forward timesheets without a registered owner identity",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true,view_manager_entries:true})})
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"unknown@example.com",status:"submitted"} as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([])
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(approveAndForward).not.toHaveBeenCalled()
})

it.each(["approved","rejected"] as const)("persists an independent contractor decision: %s",async status=>{
  const revision="2026-10-15 00:00:00.123456+00"
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",revision} as never)
  vi.mocked(updateTimeEntryWithAudit).mockResolvedValue({id:"entry",status,reviewNote:"Checked evidence",revision:"next"} as never)
  vi.mocked(rejectSubmittedEntry).mockResolvedValue({id:"entry",status,reviewNote:"Checked evidence",revision:"next"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status,reviewNote:"Checked evidence",expectedRevision:revision})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
  expect((await response.json()).entry.status).toBe(status)
  if(status==="approved")expect(approveAndForward).toHaveBeenCalledWith("entry","manager@example.com",revision,"contractor",expect.anything())
  else expect(rejectSubmittedEntry).toHaveBeenCalledWith("entry","manager@example.com",revision,"Checked evidence",expect.anything())
})

it("requires a reason before independent rejection reaches persistence",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",status:"submitted"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"rejected"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(400)
  expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("prevents view-only cross-manager access from recalling another person's submission",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{view_other_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",reviewManagerEmail:"different@example.com",status:"submitted",revision:"original"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"draft"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403);expect(updateTimeEntryWithAudit).not.toHaveBeenCalled()
})
it("returns a conflict instead of success when rejection evidence is stale",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",revision:"current"} as never)
  vi.mocked(rejectSubmittedEntry).mockResolvedValue(null)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"rejected",reviewNote:"Reason",expectedRevision:"stale"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(rejectSubmittedEntry).toHaveBeenCalledWith("entry","manager@example.com","stale","Reason",expect.anything())
})
