import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn(async()=>[]),employeeRoster:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:"test",requestMethod:"POST",requestPath:"/api/projects",requestId:"test"}))}))
vi.mock("@/lib/db",()=>({createTimeProject:vi.fn(),listTimeProjectAssignments:vi.fn().mockResolvedValue([]),listTimeProjects:vi.fn(),setTimeProjectActive:vi.fn(),setTimeProjectAssignment:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { employeeRoster } from "@/lib/collaboration"
import { createTimeProject,listTimeProjects,setTimeProjectActive,setTimeProjectAssignment } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { GET,PATCH,POST } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
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
  expect(createTimeProject).toHaveBeenCalled()
})

it("allows managers to assign projects only to active employees or contractors",async()=>{
  vi.mocked(employeeRoster).mockResolvedValue([{email:"worker@example.com",role:"contractor"}] as never)
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
