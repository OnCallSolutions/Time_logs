/**
 * Verifies sample identity scoping with synthetic sessions and no model calls.
 * Account-manager sample previews cannot create actual timesheet evidence.
 */
import { expect,it,vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolvePermissions } from "@/lib/permissions"
import { GET } from "./route"
it("uses only the contractor's authenticated name",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const value=await (await GET()).json();expect(value.count).toBeGreaterThanOrEqual(3);expect(value.count).toBeLessThanOrEqual(18);expect(value.notes.split("\n")).toHaveLength(value.count);expect(value.notes.match(/Own Person/g)).toHaveLength(value.count);expect(value.notes).not.toContain("Sample Employee")
})
it("allows multiple synthetic people for account-manager preview",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  const value=await (await GET()).json();expect(value.previewOnly).toBe(true);expect(value.notes.split("\n")).toHaveLength(value.count*2);expect(value.notes).toContain("Sample Contractor A");expect(value.notes).toContain("Sample Employee B")
})
it("returns twelve separate tasks across days/projects without accepting another identity",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const response=await GET(new Request("http://localhost/api/samples?count=12&name=SomeoneElse"))
  const value=await response.json()
  expect(value.notes.split("\n")).toHaveLength(12)
  expect(value.notes.match(/Own Person/g)).toHaveLength(12)
  expect(value.notes).toContain("Sample Integration")
  expect(value.notes).not.toContain("SomeoneElse")
})
it("rejects unbounded sample counts",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  expect((await GET(new Request("http://localhost/api/samples?count=999"))).status).toBe(400)
})
