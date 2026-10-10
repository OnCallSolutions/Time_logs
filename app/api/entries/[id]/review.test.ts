/**
 * Tests reviewer separation against authenticated identities and server-loaded ownership.
 * Own-record decisions must never reach database mutation or audit helpers.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),updateTimeEntry:vi.fn(),deleteTimeEntry:vi.fn(),recordAuditEvent:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry,updateTimeEntry,deleteTimeEntry } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { PATCH,DELETE } from "./route"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"submitted"} as never)
})
it("rejects manager-to-manager approval",async()=>{
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved"})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(403);expect(updateTimeEntry).not.toHaveBeenCalled()
})
it("permits an explicitly authorized account manager to review manager work",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{review_manager_entries:true})})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"other@example.com",status:"submitted"} as never)
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
  const revision="2026-10-10 00:00:00.123456+00"
  const response=await PATCH(new Request("http://localhost/api/entries/entry",{method:"PATCH",body:JSON.stringify({status:"approved",expectedRevision:revision})}),{params:Promise.resolve({id:"entry"})})
  expect(response.status).toBe(409)
  expect(updateTimeEntry).toHaveBeenCalledWith("manager@example.com","entry",expect.anything(),true,"manager@example.com",revision)
})
