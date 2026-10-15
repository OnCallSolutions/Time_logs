/**
 * Tests reviewer separation against authenticated identities and server-loaded ownership.
 * Own-record decisions must never reach database mutation or audit helpers.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),updateTimeEntry:vi.fn(),deleteTimeEntry:vi.fn(),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/review-requests",()=>({listReviewRequests:vi.fn(async()=>[])}))
vi.mock("@/lib/account-handoffs",()=>({approveAndForward:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry,updateTimeEntry,deleteTimeEntry } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { PATCH,DELETE } from "./route"
import { approveAndForward } from "@/lib/account-handoffs"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"submitted"} as never)
  vi.mocked(approveAndForward).mockResolvedValue({id:"entry",status:"approved"} as never)
})
it("rejects manager-to-manager approval",async()=>{
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(404);expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("permits an explicitly authorized account manager to review manager work",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted",revision:"original"} as never)
  vi.mocked(updateTimeEntry).mockResolvedValue({id:"entry",status:"approved"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
})
it("blocks self-approval even for a reviewer with team access",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("blocks self-rejection rather than letting reviewers moderate their own evidence",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"rejected",reviewNote:"Reason"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("locks a manager's own submitted evidence against editing",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({hours:12})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("locks a manager's own submitted evidence against deletion",async()=>{
  const response=await DELETE(new Request("http://localhost/api/entries/entry",{method:"DELETE"}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(deleteTimeEntry).not.toHaveBeenCalled()
})
it("does not let manager privileges reopen their own approved time",async()=>{
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"approved"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"draft"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403)
  expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("rejects revision-only patches without touching evidence",async()=>{
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({expectedRevision:"2026-10-10 00:00:00+00"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(400);expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("returns conflict when the expected evidence revision no longer matches",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
  vi.mocked(updateTimeEntry).mockResolvedValue(null)
  vi.mocked(approveAndForward).mockResolvedValue(null)
  const revision="2026-10-10 00:00:00.123456+00"
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved",expectedRevision:revision})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(approveAndForward).toHaveBeenCalledWith("entry","manager@example.com",revision,"manager",expect.anything())
})

it.each(["approved","rejected"] as const)("persists an independent contractor decision: %s",async status=>{
  const revision="2026-10-15 00:00:00.123456+00"
  vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"contractor@example.com",status:"submitted",revision} as never)
  vi.mocked(updateTimeEntry).mockResolvedValue({id:"entry",status,reviewNote:"Checked evidence",revision:"next"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status,reviewNote:"Checked evidence",expectedRevision:revision})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(200)
  expect((await response.json()).entry.status).toBe(status)
  if(status==="approved")expect(approveAndForward).toHaveBeenCalledWith("entry","manager@example.com",revision,"contractor",expect.anything())
  else expect(updateTimeEntry).toHaveBeenCalledWith("manager@example.com","entry",expect.objectContaining({status,reviewNote:"Checked evidence"}),true,"manager@example.com",revision)
})

it("requires a reason before independent rejection reaches persistence",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee")
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"employee@example.com",status:"submitted"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"rejected"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(400)
  expect(updateTimeEntry).not.toHaveBeenCalled()
})
