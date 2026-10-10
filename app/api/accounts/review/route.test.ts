/**
 * Verifies scoped advisory account review without real AI or database calls.
 * Out-of-scope IDs and changed evidence must not produce actionable advice.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({listHandoffs:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
vi.mock("ai",()=>({generateText:vi.fn(),Output:{object:vi.fn()}}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listHandoffs } from "@/lib/account-handoffs"
import { resolvePermissions } from "@/lib/permissions"
import { generateText } from "ai"
import { POST } from "./route"
const id="123e4567-e89b-42d3-a456-426614174000"
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,ai_accounts:true})})
  vi.mocked(listHandoffs).mockResolvedValue([{id,current:true,review_state:"pending",review_version:0,evidence:{ownerEmail:"supplier@example.com",reviewedBy:"manager@example.com",workerCategory:"contractor",date:"2026-10-10",hours:4,project:"Project",description:"Work"}}] as never)
  vi.mocked(generateText).mockResolvedValue({output:{summary:"No obvious inconsistency",recommendations:[{handoffId:id,assessment:"looks_consistent",severity:"low",reason:"Recorded evidence aligns"}]}} as never)
})
/** @param ids - Selected synthetic queue IDs. @returns An explicit advisory request. */
function request(ids:string[]){return new Request("http://localhost/api/accounts/review",{method:"POST",body:JSON.stringify({ids})})}
it("does not call AI when the account has only visibility rights",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  expect((await POST(request([id]))).status).toBe(403)
  expect(generateText).not.toHaveBeenCalled()
})
it("rejects out-of-scope identifiers before model execution",async()=>{
  expect((await POST(request(["123e4567-e89b-42d3-a456-426614174001"]))).status).toBe(403)
  expect(generateText).not.toHaveBeenCalled()
})
it("pseudonymizes identities and does not modify queue state",async()=>{
  expect((await POST(request([id]))).status).toBe(200)
  const prompt=vi.mocked(generateText).mock.calls[0][0].prompt as string
  expect(prompt).not.toContain("supplier@example.com")
  expect(prompt).not.toContain("manager@example.com")
  expect(prompt).toContain("person-1")
})
it("invalidates advice if the source changes during model execution",async()=>{
  vi.mocked(listHandoffs).mockResolvedValueOnce([{id,current:true,review_state:"pending",review_version:0,evidence:{ownerEmail:"supplier@example.com",reviewedBy:"manager@example.com"}}] as never).mockResolvedValueOnce([])
  expect((await POST(request([id]))).status).toBe(409)
})
