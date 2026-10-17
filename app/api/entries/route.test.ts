import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/review-policy",()=>({canReviewRole:vi.fn()}))
vi.mock("@/lib/review-access",()=>({createReviewAccess:vi.fn()}))
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn()}))
vi.mock("@/lib/account-handoffs",()=>({ensureAccountHandoffStorage:vi.fn()}))
vi.mock("@/lib/app-sessions",()=>({isAppSessionFresh:vi.fn().mockResolvedValue(true)}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:"127.0.0.1",userAgent:"test",requestMethod:"POST",requestPath:"/api/entries",requestId:"req-1"}))}))
vi.mock("@/lib/db",()=>({clearTimeEntries:vi.fn(),createTimeEntries:vi.fn(),listTimeEntries:vi.fn(),recordAuditEvent:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { createReviewAccess } from "@/lib/review-access"
import { isAppSessionFresh } from "@/lib/app-sessions"
import { listAccountIdentities } from "@/lib/account-identities"
import { clearTimeEntries,createTimeEntries,listTimeEntries } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import type { TimeEntry } from "@/lib/types"
import { DELETE,GET,POST } from "./route"

const savedEntry:TimeEntry={id:"10000000-0000-4000-8000-000000000001",ownerEmail:"person@example.com",contractor:"Official Person",contractorNumber:"DEVONCALL-000001",shortReference:"TN-000001",date:"2026-10-15",hours:4,project:"Project A",description:"Saved work",status:"draft",revision:"2026-10-15T12:00:00.000Z"}

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"}} as never)
  vi.mocked(isAppSessionFresh).mockResolvedValue(true)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")} as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([{email:"person@example.com",officialName:"Official Person",contractorNumber:"DEVONCALL-000001",shortReference:"TN-000001",companyCode:"DEVONCALL",employeeId:null}] as never)
  vi.mocked(listTimeEntries).mockResolvedValue([savedEntry] as never)
  vi.mocked(createReviewAccess).mockReturnValue((async()=>({visible:true,reviewable:false})) as never)
})

it("creates entries under the signed-in official identity and atomically passes request audit context",async()=>{
  const request=new Request("http://localhost/api/entries",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entries:[{contractor:"Forged display name",date:"2026-10-15",hours:4,project:"Project A",description:"Saved work"}]})})
  vi.mocked(createTimeEntries).mockResolvedValue([savedEntry] as never)
  const response=await POST(request)
  expect(response.status).toBe(201)
  expect((await response.json()).entries).toEqual([savedEntry])
  expect(createTimeEntries).toHaveBeenCalledWith("person@example.com",[expect.objectContaining({contractor:"Official Person"})],"DEVONCALL-000001",expect.objectContaining({requestMethod:"POST",requestPath:"/api/entries"}))
})

it("retrieves saved rows through the authenticated owner's scoped query without caching",async()=>{
  const secondEntry={...savedEntry,id:"20000000-0000-4000-8000-000000000002",description:"Second work unit",hours:2}
  vi.mocked(listTimeEntries).mockResolvedValue([savedEntry,secondEntry] as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(listTimeEntries).toHaveBeenCalledWith("person@example.com",false)
  const result=await response.json()
  expect(result.entries).toHaveLength(2)
  expect(result.entries.map((entry:{id:string})=>entry.id)).toEqual([savedEntry.id,secondEntry.id])
  expect(result.entries[0]).toMatchObject({ownerEmail:"person@example.com",contractor:"Official Person",status:"draft"})
})

it("rejects unauthenticated writes and never calls persistence",async()=>{
  vi.mocked(auth).mockResolvedValue(null as never)
  const response=await POST(new Request("http://localhost/api/entries",{method:"POST",body:JSON.stringify({entries:[{contractor:"Person",date:"2026-10-15",hours:4,project:"Project A",description:"Work"}]})}))
  expect(response.status).toBe(401)
  expect(createTimeEntries).not.toHaveBeenCalled()
})

it("allows only administrators to request an organization-wide timesheet clear and audits its scope",async()=>{
  const {clearTimeEntries,recordAuditEvent}=await import("@/lib/db")
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"},appSessionId:"fresh-session"} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")} as never)
  vi.mocked(clearTimeEntries).mockResolvedValue(4)
  const response=await DELETE(new Request("http://localhost/api/entries",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"all_entries"})}))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ok:true,deletedCount:4})
  expect(clearTimeEntries).toHaveBeenCalledWith("admin@example.com",true)
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"entries_cleared",metadata:expect.objectContaining({scope:"all_entries",deletedCount:4,financeHandoffsPreserved:true})}))
})

it("requires recent Microsoft reauthentication for organization-wide entry clearing",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"},appSessionId:"stale-session"} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")} as never)
  vi.mocked(isAppSessionFresh).mockResolvedValue(false)
  const response=await DELETE(new Request("http://localhost/api/entries",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"all_entries"})}))
  expect(response.status).toBe(428)
  expect(clearTimeEntries).not.toHaveBeenCalled()
})

it("rejects an organization-wide clear request from a non-admin",async()=>{
  const {clearTimeEntries}=await import("@/lib/db")
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor",{delete_entries:true})} as never)
  const response=await DELETE(new Request("http://localhost/api/entries",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"all_entries"})}))
  expect(response.status).toBe(403)
  expect(clearTimeEntries).not.toHaveBeenCalled()
})
