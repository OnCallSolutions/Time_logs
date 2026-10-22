/**
 * Verifies sample identity scoping with synthetic sessions and no model calls.
 * Account-manager sample previews cannot create actual timesheet evidence.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn(async()=>null)}))
vi.mock("@/lib/db",()=>({listTimeEntries:vi.fn(async()=>[]),listTimeProjects:vi.fn(async()=>["Sample Project Alpha","Sample Project Beta","Sample Integration","Sample Field Operations"].map((name,index)=>({id:String(index),name,description:"",active:true}))),listTimesheetPeriods:vi.fn(async()=>[{id:"10000000-0000-4000-8000-000000000001",name:"Current period",startDate:"2026-10-17",endDate:"2026-10-23",timezone:"America/New_York"}])}))
vi.mock("@/lib/review-access",()=>({createReviewAccess:vi.fn(()=>async()=>({visible:true,reviewable:true}))}))
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listTimeEntries,listTimeProjects,listTimesheetPeriods } from "@/lib/db"
import { listAccountIdentities } from "@/lib/account-identities"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { createReviewAccess } from "@/lib/review-access"
import { resolvePermissions } from "@/lib/permissions"
import { GET } from "./route"
beforeEach(()=>{
  vi.mocked(listAccountIdentities).mockResolvedValue([])
  vi.mocked(getEffectiveUserRole).mockResolvedValue(null)
  vi.mocked(listTimeEntries).mockResolvedValue([])
  vi.mocked(listTimeProjects).mockResolvedValue(["Sample Project Alpha","Sample Project Beta","Sample Integration","Sample Field Operations"].map((name,index)=>({id:String(index),name,description:"",active:true})) as never)
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"10000000-0000-4000-8000-000000000001",name:"Current period",startDate:"2026-10-17",endDate:"2026-10-23",timezone:"America/New_York"}] as never)
  vi.mocked(createReviewAccess).mockReturnValue(async()=>({visible:true,reviewable:true}))
})
it("uses only the contractor's authenticated name",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const value=await (await GET()).json();expect(value.count).toBeGreaterThanOrEqual(3);expect(value.count).toBeLessThanOrEqual(18);expect(value.notes.split("\n")).toHaveLength(value.count);expect(value.notes.match(/Own Person/g)).toHaveLength(value.count);expect(value.notes).toContain("SAMPLE-USER-001");expect(value.previewOnly).toBe(false)
})
it("varies synthetic project names even in the smallest sample batch",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const response=await GET(new Request("http://localhost/api/samples?count=3"))
  const value=await response.json()
  const projects=[...value.notes.matchAll(/hours on ([^,]+),/g)].map((match:RegExpMatchArray)=>match[1])
  expect(projects).toEqual(["Sample Project Alpha","Sample Project Beta","Sample Integration"])
  expect(new Set(projects).size).toBe(3)
})
it.each(["manager","account_manager"] as const)("uses generic named and identified display-only samples for %s",async role=>{
  vi.mocked(auth).mockResolvedValue({user:{email:`${role}@example.com`,name:"Real Manager Name"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role,permissions:resolvePermissions(role,role==="account_manager"?{view_accounts:true}:undefined)})
  const value=await (await GET()).json()
  expect(value.previewOnly).toBe(true)
  expect(value.notes.split("\n")).toHaveLength(value.count*3)
  expect(value.notes).toContain("Sample Contractor A (ID: SAMPLE-CTR-001)")
  expect(value.notes).toContain("Sample Employee B (ID: SAMPLE-EMP-002)")
  expect(value.notes).toContain(role==="manager"?"Sample Employee C (ID: SAMPLE-EMP-003)":"Sample Manager C (ID: SAMPLE-MGR-003)")
  expect(value.notes).not.toContain("Real Manager Name")
})
it("uses several active company employee names for admin sample previews",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com",name:"Admin Name"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(listAccountIdentities).mockResolvedValue([
    {email:"one@example.com",officialName:"Alex Employee",contractorNumber:"TN-private-one"},
    {email:"two@example.com",officialName:"Casey Contractor",contractorNumber:"TN-private-two"},
  ] as never)
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="two@example.com"?"contractor":"employee")
  const value=await (await GET()).json()
  expect(value.people).toBe(2)
  expect(value.previewOnly).toBe(true)
  expect(value.notes).toContain("Alex Employee (ID: SAMPLE-EMP-001)")
  expect(value.notes).toContain("Casey Contractor (ID: SAMPLE-CTR-002)")
  expect(value.notes).not.toContain("TN-private")
})
it("limits manager sample names to people represented in review-visible submissions",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com",name:"Manager Name"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(listTimeEntries).mockResolvedValue([
    {id:"visible",ownerEmail:"visible@example.com",status:"submitted"},
    {id:"hidden",ownerEmail:"hidden@example.com",status:"submitted"},
  ] as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([
    {email:"visible@example.com",officialName:"Visible Employee",contractorNumber:"TN-private-one"},
  ] as never)
  vi.mocked(getEffectiveUserRole).mockImplementation(async email=>email==="visible@example.com"||email==="hidden@example.com"?"employee":"manager")
  vi.mocked(createReviewAccess).mockReturnValue(async entry=>({visible:entry.id==="visible",reviewable:true}))
  const value=await (await GET()).json()
  expect(value.notes).toContain("Visible Employee (ID: SAMPLE-EMP-001)")
  expect(value.notes).not.toContain("hidden@example.com")
  expect(value.notes).not.toContain("TN-private")
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
it("returns a synthetic, period-scoped Teams transcript using the signed-in patron and an available project",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"own@example.com",name:"Own Person"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  const periodId="10000000-0000-4000-8000-000000000001"
  const response=await GET(new Request(`http://localhost/api/samples?format=teams-transcript&periodId=${periodId}`))
  const value=await response.json()
  expect(response.status).toBe(200)
  expect(value).toMatchObject({synthetic:true,transcript:true,periodId,project:"Sample Project Alpha"})
  expect(value.notes).toContain("Synthetic Microsoft Teams transcript")
  expect(value.notes).toContain("Own Person")
  expect(value.notes).toContain("2026-10-17")
  expect(value.notes).toContain("2 hours on Sample Project Alpha")
})
