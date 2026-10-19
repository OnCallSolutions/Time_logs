import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn(async()=>[]),employeeRoster:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:"test",requestMethod:"POST",requestPath:"/api/projects",requestId:"test"}))}))
vi.mock("@/lib/db",()=>({createTimeProject:vi.fn(),deleteUnusedTimeProject:vi.fn(),isManagerProjectManager:vi.fn().mockResolvedValue(true),listManagerTimeProjectAssignmentHistory:vi.fn().mockResolvedValue([]),listManagerTimeProjectAssignments:vi.fn().mockResolvedValue([]),listManagerTimeProjects:vi.fn().mockResolvedValue([]),listManagerWorkforceEmails:vi.fn().mockResolvedValue([]),listTimeProjectAssignmentHistory:vi.fn().mockResolvedValue([]),listTimeProjectAssignments:vi.fn().mockResolvedValue([]),listTimeProjects:vi.fn(),mergeTimeProjectInto:vi.fn(),setTimeProjectActive:vi.fn(),setTimeProjectAssignment:vi.fn(),setTimeProjectAssignmentStatus:vi.fn()}))
vi.mock("@/lib/submission-reviewer",()=>({resolvePatronManager:vi.fn(async()=>null)}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster,employeeRoster } from "@/lib/collaboration"
import { createTimeProject,isManagerProjectManager,listManagerTimeProjectAssignmentHistory,listManagerTimeProjectAssignments,listManagerTimeProjects,listManagerWorkforceEmails,listTimeProjectAssignmentHistory,listTimeProjectAssignments,listTimeProjects,mergeTimeProjectInto,setTimeProjectActive,setTimeProjectAssignment,setTimeProjectAssignmentStatus } from "@/lib/db"
import { resolvePatronManager } from "@/lib/submission-reviewer"
import { resolvePermissions } from "@/lib/permissions"
import { GET,PATCH,POST } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(resolvePatronManager).mockResolvedValue(null)
  vi.mocked(isManagerProjectManager).mockResolvedValue(true)
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue([])
  vi.mocked(listTimeProjectAssignmentHistory).mockResolvedValue([])
  vi.mocked(listManagerTimeProjectAssignmentHistory).mockResolvedValue([])
  vi.mocked(listManagerTimeProjectAssignments).mockResolvedValue([])
  vi.mocked(listManagerTimeProjects).mockResolvedValue([])
  vi.mocked(actorRoster).mockResolvedValue([] as never)
  vi.mocked(employeeRoster).mockResolvedValue([] as never)
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")} as never)
  vi.mocked(listTimeProjects).mockResolvedValue([{id:"10000000-0000-4000-8000-000000000001",name:"Project A",description:"",active:true,createdBy:"manager@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"}])
})

it("lets managers create catalog projects",async()=>{
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"Project A",description:"",active:true,createdBy:"manager@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Project A"})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalled()
})

it("lets account managers manage projects by default",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager")} as never)
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"Period Project",description:"",active:true,createdBy:"accounts@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Period Project"})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalled()
})

it("respects admin revocation of account-manager project management",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"accounts@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"account_manager",permissions:resolvePermissions("account_manager",{manage_projects:false})} as never)
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Denied Project"})}))
  expect(response.status).toBe(403)
  expect(createTimeProject).not.toHaveBeenCalled()
})

it("denies contractor project creation until a manager grants the dedicated right",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")} as never)
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"New Project"})}))
  expect(response.status).toBe(403)
  expect(createTimeProject).not.toHaveBeenCalled()
})

it("allows project creation after manager-granted create_projects permission",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor",{create_projects:true})} as never)
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"New Project",description:"",active:true,createdBy:"contractor@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"New Project"})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalledWith({name:"New Project",description:""},"contractor@example.com",expect.anything(),true,undefined,[])
})

it("records the appointed manager separately without assigning them to a self-created project",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor",{create_projects:true})} as never)
  vi.mocked(resolvePatronManager).mockResolvedValue({email:"manager@example.com",displayName:"Manager"})
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"New Project",description:"",active:true,createdBy:"contractor@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"New Project"})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalledWith({name:"New Project",description:""},"contractor@example.com",expect.anything(),true,"manager@example.com",[])
})

it("lets a manager resolve a submitted self-created project into a canonical project",async()=>{
  vi.mocked(mergeTimeProjectInto).mockResolvedValue({sourceName:"Bridge repair",targetName:"Bridge Repairs",updatedEntries:4})
  const response=await PATCH(new Request("http://localhost/api/projects",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"merge",sourceProjectId:"10000000-0000-4000-8000-000000000001",targetProjectId:"10000000-0000-4000-8000-000000000002"})}))
  expect(response.status).toBe(200)
  expect(mergeTimeProjectInto).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002","manager@example.com",expect.anything())
  expect(await response.json()).toMatchObject({ok:true,sourceName:"Bridge repair",targetName:"Bridge Repairs",updatedEntries:4})
})

it("allows an authorized employee to create a project assigned to them",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:resolvePermissions("employee",{create_projects:true})} as never)
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"New Project",description:"",active:true,createdBy:"employee@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"New Project"})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalledWith({name:"New Project",description:""},"employee@example.com",expect.anything(),true,undefined,[])
})

it("allows managers to assign projects only to active employees or contractors",async()=>{
  vi.mocked(employeeRoster).mockResolvedValue([{email:"worker@example.com",role:"contractor"}] as never)
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["worker@example.com"])
  vi.mocked(setTimeProjectAssignment).mockResolvedValue(true)
  const response=await PATCH(new Request("http://localhost/api/projects",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"assignment",projectId:"10000000-0000-4000-8000-000000000001",email:"worker@example.com",assigned:true})}))
  expect(response.status).toBe(200)
  expect(setTimeProjectAssignment).toHaveBeenCalled()
})

it("does not expose unassigned projects to contractors",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")} as never)
  vi.mocked(listTimeProjects).mockResolvedValue([])
  const response=await GET()
  expect(response.status).toBe(200)
  expect(listTimeProjects).toHaveBeenCalledWith(false,"contractor@example.com")
  expect((await response.json()).projects).toEqual([])
})

it("includes only project-assigned managers in the manager assignment directory",async()=>{
  vi.mocked(listManagerTimeProjectAssignments).mockResolvedValue([{projectId:"project-1",email:"manager@example.com",status:"active"},{projectId:"project-1",email:"contractor@example.com",status:"active"}])
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["contractor@example.com"])
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"contractor@example.com",displayName:"Taylor",role:"contractor",accessStatus:"active"},
    {email:"manager@example.com",displayName:"Morgan Manager",role:"manager",accessStatus:"active"},
    {email:"other-manager@example.com",displayName:"Other Manager",role:"manager",accessStatus:"active"},
  ] as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect((await response.json()).patrons).toEqual([
    {email:"contractor@example.com",displayName:"Taylor",role:"contractor"},
    {email:"manager@example.com",displayName:"Morgan Manager",role:"manager"},
  ])
})

it("limits a regular manager's project list, assignments, and people to their own team",async()=>{
  vi.mocked(listManagerTimeProjects).mockResolvedValue([{id:"manager-project",name:"My Project",description:"",active:true,createdBy:"manager@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"}])
  vi.mocked(listManagerTimeProjectAssignments).mockResolvedValue([{projectId:"manager-project",email:"worker@example.com",status:"active"}])
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["worker@example.com"])
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"worker@example.com",displayName:"Taylor",role:"contractor",accessStatus:"active"},
    {email:"other@example.com",displayName:"Other",role:"contractor",accessStatus:"active"},
  ] as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect(listManagerTimeProjects).toHaveBeenCalledWith("manager@example.com",true)
  expect((await response.json()).patrons).toEqual([{email:"worker@example.com",displayName:"Taylor",role:"contractor"}])
})

it("lets a manager pause a project assignment while preserving the assignment record",async()=>{
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["worker@example.com"])
  vi.mocked(setTimeProjectAssignmentStatus).mockResolvedValue(true)
  const response=await PATCH(new Request("http://localhost/api/projects",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"assignment_status",projectId:"10000000-0000-4000-8000-000000000001",email:"worker@example.com",status:"paused"})}))
  expect(response.status).toBe(200)
  expect(setTimeProjectAssignmentStatus).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001","worker@example.com","paused","manager@example.com",expect.anything())
})

it("creates a manager project with selected team assignments in one operation",async()=>{
  vi.mocked(employeeRoster).mockResolvedValue([{email:"worker@example.com",role:"contractor"}] as never)
  vi.mocked(listManagerWorkforceEmails).mockResolvedValue(["worker@example.com"])
  vi.mocked(createTimeProject).mockResolvedValue({id:"10000000-0000-4000-8000-000000000001",name:"Project A",description:"",active:true,createdBy:"manager@example.com",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"})
  const response=await POST(new Request("http://localhost/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Project A",initialAssignmentEmails:["worker@example.com"]})}))
  expect(response.status).toBe(201)
  expect(createTimeProject).toHaveBeenCalledWith({name:"Project A",description:""},"manager@example.com",expect.anything(),false,undefined,["worker@example.com"])
})

it("returns assignment history to project managers",async()=>{
  const history=[{id:"event-1",projectId:"project-1",projectName:"Project A",email:"worker@example.com",action:"assigned",actorEmail:"manager@example.com",occurredAt:"2026-10-18T15:00:00.000Z"}]
  vi.mocked(listManagerTimeProjectAssignments).mockResolvedValue([])
  vi.mocked(listManagerTimeProjectAssignmentHistory).mockResolvedValue(history as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect((await response.json()).assignmentHistory).toEqual(history)
  expect(listManagerTimeProjectAssignmentHistory).toHaveBeenCalledOnce()
})

it("does not expose project assignment history to contractors",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")} as never)
  const response=await GET()
  expect(response.status).toBe(200)
  expect((await response.json()).assignmentHistory).toEqual([])
  expect(listTimeProjectAssignmentHistory).not.toHaveBeenCalled()
})
