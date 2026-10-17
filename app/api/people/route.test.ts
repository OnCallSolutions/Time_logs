/**
 * Covers manager/admin onboarding with normalized names and duplicate-safe policy.
 * Existing access, blocked identities and elevated roles cannot be overwritten here.
 * Storage and Microsoft sessions are isolated; SQL uniqueness remains a database gate.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn(),getConfiguredAccessUsers:vi.fn(()=>[])}))
vi.mock("@/lib/db",()=>({listKnownUsers:vi.fn(async()=>[]),listManagedAccessUsers:vi.fn(async()=>[]),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[]),onboardAccount:vi.fn(),setOfficialIdentity:vi.fn()}))
vi.mock("@/lib/company-directory",()=>({companyEmailDomains:vi.fn(()=>["devoncall.net"])}))
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listKnownUsers } from "@/lib/db"
import { listAccountIdentities,onboardAccount,setOfficialIdentity } from "@/lib/account-identities"
import { recordAuditEvent } from "@/lib/db"
import { PATCH,POST } from "./route"
beforeEach(()=>{vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never);vi.mocked(getEffectiveUserRole).mockResolvedValue("manager");vi.mocked(onboardAccount).mockResolvedValue({email:"person@example.com",officialName:"Person Name",contractorNumber:"TN-unique"})})
/** @param extra - Untrusted onboarding overrides. @returns Request with otherwise valid employee details. */
function request(extra:object={}){return new Request("http://localhost/api/people",{method:"POST",body:JSON.stringify({email:" Person@EXAMPLE.com ",officialName:"pERSON nAME",role:"contractor",...extra})})}
it("lets managers create normalized baseline identities with server-generated IDs",async()=>{
  expect((await POST(request())).status).toBe(201)
  expect(onboardAccount).toHaveBeenCalledWith(expect.objectContaining({email:"person@example.com",officialName:"Person Name",role:"contractor"}))
})
it("allows personal Gmail onboarding even when organization domains are configured",async()=>{
  expect((await POST(request({email:"OTIENOMAURICE2003@GMAIL.COM"}))).status).toBe(201)
  expect(onboardAccount).toHaveBeenCalledWith(expect.objectContaining({email:"otienomaurice2003@gmail.com"}))
})
it("rejects elevated roles, client identifiers and permission injection",async()=>{
  for(const extra of [{role:"admin"},{contractorNumber:"mine"},{permissions:{view_accounts:true}}])expect((await POST(request(extra))).status).toBe(400)
  expect(onboardAccount).not.toHaveBeenCalled()
})
it("does not let managers overwrite an existing identity",async()=>{
  expect((await POST(request({correctExisting:true}))).status).toBe(403)
  expect(setOfficialIdentity).not.toHaveBeenCalled()
  vi.mocked(onboardAccount).mockResolvedValue(null)
  expect((await POST(request())).status).toBe(409)
})
it("maps concurrent duplicate names to a safe conflict without exposing SQL",async()=>{
  vi.mocked(onboardAccount).mockRejectedValue({code:"23505"})
  const response=await POST(request())
  expect(response.status).toBe(409)
  expect((await response.json()).error).toContain("already registered")
})

it("lets only admins rename an existing patron without accepting an ID",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(listKnownUsers).mockResolvedValue([{email:"person@example.com"}] as never)
  vi.mocked(setOfficialIdentity).mockResolvedValue({email:"person@example.com",officialName:"Person Name",contractorNumber:"TN-immutable"})
  const response=await PATCH(new Request("http://localhost/api/people",{method:"PATCH",body:JSON.stringify({email:"person@example.com",officialName:"pERSON nAME"})}))
  expect(response.status).toBe(200)
  expect(setOfficialIdentity).toHaveBeenCalledWith("person@example.com","Person Name","manager@example.com",undefined)
})

it("lets only admins update or clear a company-issued patron ID and audits changed fields",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(listKnownUsers).mockResolvedValue([{email:"person@example.com"}] as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([{email:"person@example.com",officialName:"Person Name",contractorNumber:"TN-immutable",employeeId:"OLD-7"}] as never)
  vi.mocked(setOfficialIdentity).mockResolvedValue({email:"person@example.com",officialName:"Person Name",contractorNumber:"TN-immutable",employeeId:"NEW-8"})
  const response=await PATCH(new Request("http://localhost/api/people",{method:"PATCH",body:JSON.stringify({email:"person@example.com",officialName:"Person Name",employeeId:" NEW-8 "})}))
  expect(response.status).toBe(200)
  expect(setOfficialIdentity).toHaveBeenCalledWith("person@example.com","Person Name","manager@example.com","NEW-8")
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({targetId:"person@example.com",metadata:{changedFields:["employeeId"]}}))
  await PATCH(new Request("http://localhost/api/people",{method:"PATCH",body:JSON.stringify({email:"person@example.com",officialName:"Person Name",employeeId:null})}))
  expect(setOfficialIdentity).toHaveBeenLastCalledWith("person@example.com","Person Name","manager@example.com",null)
})

it("does not allow managers to rename patrons",async()=>{
  expect((await PATCH(new Request("http://localhost/api/people",{method:"PATCH",body:JSON.stringify({email:"person@example.com",officialName:"Person Name"})}))).status).toBe(403)
  expect(setOfficialIdentity).not.toHaveBeenCalled()
})
