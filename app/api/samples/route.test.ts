/**
 * Verifies sample identity scoping with synthetic sessions and no model calls.
 * Account-manager sample previews cannot create actual timesheet evidence.
 */
import { expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolvePermissions } from "@/lib/permissions"
import { GET } from "./route"
it("uses only the contractor's authenticated name",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const value=await (await GET()).json();expect(value.notes.match(/Own Person/g)).toHaveLength(2);expect(value.notes).not.toContain("Sample Employee")
})
it("allows multiple synthetic people for account-manager preview",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  const value=await (await GET()).json();expect(value.previewOnly).toBe(true);expect(value.notes).toContain("Sample Contractor A");expect(value.notes).toContain("Sample Employee B")
})
