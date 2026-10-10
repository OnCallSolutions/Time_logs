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
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),listTimeEntries:vi.fn(),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({createHandoffs:vi.fn(),listHandoffs:vi.fn(),reviewHandoff:vi.fn(),accountReviewStates:["pending","needs_information","ready_for_finance","archived"]}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry } from "@/lib/db"
import { createHandoffs,listHandoffs,reviewHandoff } from "@/lib/account-handoffs"
import { resolvePermissions } from "@/lib/permissions"
import { GET,POST,PATCH } from "./route"
const id="123e4567-e89b-42d3-a456-426614174000"
/** @returns An explicit handoff request, with no trusted identity supplied by the client. */
function request(){return new Request("http://localhost/tanovo-time/api/accounts",{method:"POST",body:JSON.stringify({ids:[id],recipient:"accounts@example.com"})})}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_to_accounts:true})})
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="accounts@example.com"?"account_manager":"contractor")
  vi.mocked(getTimeEntry).mockResolvedValue({id,status:"approved",ownerEmail:"supplier@example.com"} as never)
  vi.mocked(createHandoffs).mockResolvedValue([{id,entry_id:id}])
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
it("requires separate account triage rights even when queue visibility exists",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  expect((await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({id,state:"needs_information",note:"Check evidence",version:0})}))).status).toBe(403)
  expect(reviewHandoff).not.toHaveBeenCalled()
})
it("reports a conflict rather than accepting stale account-review evidence",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true,review_accounts:true})})
  vi.mocked(reviewHandoff).mockResolvedValue(null)
  expect((await PATCH(new Request("http://localhost/api/accounts",{method:"PATCH",body:JSON.stringify({id,state:"ready_for_finance",note:"Reviewed evidence",version:0})}))).status).toBe(409)
})
it("scopes account-manager queue reads to the authenticated assignee",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{view_accounts:true})})
  vi.mocked(listHandoffs).mockResolvedValue([])
  expect((await GET()).status).toBe(200)
  expect(listHandoffs).toHaveBeenCalledWith("accounts@example.com",false)
})
