/**
 * Tests reviewer separation against authenticated identities and server-loaded ownership.
 * Own-record decisions must never reach database mutation or audit helpers.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),updateTimeEntry:vi.fn(),deleteTimeEntry:vi.fn(),recordAuditEvent:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getTimeEntry,updateTimeEntry,deleteTimeEntry } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { PATCH,DELETE } from "./route"
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getTimeEntry).mockResolvedValue({id:"entry",ownerEmail:"manager@example.com",status:"submitted"} as never)
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
