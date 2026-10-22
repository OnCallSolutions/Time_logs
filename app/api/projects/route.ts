import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { actorRoster,employeeRoster } from "@/lib/collaboration"
import { createTimeProject, deleteUnusedTimeProject, isManagerProjectManager, listManagerTimeProjectAssignmentHistory, listManagerTimeProjectAssignments, listManagerTimeProjects, listManagerWorkforceEmails, listTimeProjectAssignmentHistory, listTimeProjectAssignments, listTimeProjects, mergeTimeProjectInto, setTimeProjectActive, setTimeProjectAssignment, setTimeProjectAssignmentStatus } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { resolvePatronManager } from "@/lib/submission-reviewer"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

export const runtime="nodejs"

async function currentAccess(){
  const email=(await auth())?.user?.email?.toLowerCase()??null
  const {role,permissions}=await getEffectivePermissions(email)
  return email&&role?{email,role,permissions}:null
}

async function getProjects(){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    const canManage=(access.role==="admin"||access.role==="manager"||access.role==="account_manager")&&access.permissions.manage_projects
    const organizationWide=canManage&&(access.role==="admin"||access.role==="account_manager")
    const managerScoped=canManage&&access.role==="manager"
    const [projects,assignments,assignmentHistory,teamEmails]=await Promise.all([
      organizationWide?listTimeProjects(true):managerScoped?listManagerTimeProjects(access.email,true):listTimeProjects(false,access.email),
      organizationWide?listTimeProjectAssignments():managerScoped?listManagerTimeProjectAssignments(access.email):Promise.resolve([]),
      organizationWide?listTimeProjectAssignmentHistory():managerScoped?listManagerTimeProjectAssignmentHistory(access.email):Promise.resolve([]),
      managerScoped?listManagerWorkforceEmails(access.email):Promise.resolve([]),
    ])
    const assignedManagers=new Set([...assignments.map(item=>item.email.toLowerCase()),...projects.map(project=>project.managerEmail?.toLowerCase()).filter((email):email is string=>!!email)])
    const managerTeam=new Set([...teamEmails,...assignments.map(item=>item.email.toLowerCase())])
    const patrons=canManage?(await actorRoster()).filter(user=>user.accessStatus==="active"&&(
      (user.role==="employee"||user.role==="contractor")&&(organizationWide||managerTeam.has(user.email.toLowerCase()))||
      ((user.role==="manager"||user.role==="account_manager")&&assignedManagers.has(user.email.toLowerCase()))
    )).map(user=>({email:user.email,displayName:user.displayName,role:user.role})):[]
    return Response.json({projects,assignments,assignmentHistory,patrons},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Unable to load assigned projects."},{status:500})
  }
}

async function createProject(req:Request){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    const mayCreate=(access.role==="admin"||access.role==="manager"||access.role==="account_manager")&&access.permissions.manage_projects||((access.role==="contractor"||access.role==="employee")&&access.permissions.create_projects)
    if(!mayCreate)return Response.json({error:"A manager must grant you project-creation permission first."},{status:403})
    const body=z.object({name:z.string().trim().min(1).max(120),description:z.string().trim().max(500).default(""),initialAssignmentEmails:z.array(z.string().email()).max(200).default([])}).strict().parse(await req.json())
    if(body.initialAssignmentEmails.length&&!(access.role==="admin"||access.role==="manager"||access.role==="account_manager")||body.initialAssignmentEmails.length&&!access.permissions.manage_projects)return Response.json({error:"Only project managers can assign people during creation."},{status:403})
    const uniqueEmails=[...new Set(body.initialAssignmentEmails.map(email=>email.toLowerCase()))]
    const eligible=new Set(uniqueEmails.length?(await employeeRoster()).map(user=>user.email.toLowerCase()):[])
    if(uniqueEmails.some(email=>!eligible.has(email)))return Response.json({error:"Choose active employees or contractors for the initial assignment."},{status:400})
    if(access.role==="manager"){
      const team=new Set(uniqueEmails.length?await listManagerWorkforceEmails(access.email):[])
      if(uniqueEmails.some(email=>!team.has(email)))return Response.json({error:"You can assign only contractors or employees in your team."},{status:403})
    }
    const assignCreator=access.role==="contractor"||access.role==="employee"
    const manager=assignCreator?await resolvePatronManager(access.email):null
    const project=manager
      ?await createTimeProject({name:body.name,description:body.description},access.email,getAuditContext(req),assignCreator,manager.email,uniqueEmails)
      :await createTimeProject({name:body.name,description:body.description},access.email,getAuditContext(req),assignCreator,undefined,uniqueEmails)
    if(!project)return Response.json({error:"A project with that name already exists."},{status:409})
    return Response.json({project},{status:201})
  }catch(error){
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Enter a valid project name and description."},{status:400})
    return Response.json({error:"Unable to create project."},{status:500})
  }
}

async function updateProject(req:Request){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    if(!["admin","manager","account_manager"].includes(access.role)||!access.permissions.manage_projects)return Response.json({error:"Project management rights are required to assign or archive projects."},{status:403})
    const body=z.discriminatedUnion("action",[
      z.object({action:z.literal("assignment"),projectId:z.string().uuid(),email:z.string().email(),assigned:z.boolean()}),
      z.object({action:z.literal("assignment_status"),projectId:z.string().uuid(),email:z.string().email(),status:z.enum(["active","paused"])}),
      z.object({action:z.literal("merge"),sourceProjectId:z.string().uuid(),targetProjectId:z.string().uuid()}),
      z.object({action:z.literal("status"),projectId:z.string().uuid(),active:z.boolean()}),
      z.object({action:z.literal("delete_unused"),projectId:z.string().uuid()}),
    ]).parse(await req.json())
    if(body.action==="merge"){
      if(access.role==="manager"&&(!await isManagerProjectManager(access.email,body.sourceProjectId)||!await isManagerProjectManager(access.email,body.targetProjectId)))return Response.json({error:"You can resolve project matches only within projects you manage."},{status:403})
      const result=await mergeTimeProjectInto(body.sourceProjectId,body.targetProjectId,access.email,getAuditContext(req))
      return result?Response.json({ok:true,...result}):Response.json({error:"Project match could not be resolved. Refresh the project list and try again."},{status:409})
    }
    if(body.action==="assignment"){
      if(access.role==="manager"&&!await isManagerProjectManager(access.email,body.projectId))return Response.json({error:"You can change assignments only for projects you manage."},{status:403})
      const target=(await employeeRoster()).find(user=>user.email.toLowerCase()===body.email.toLowerCase())
      if(!target||!(target.role==="employee"||target.role==="contractor"))return Response.json({error:"Choose an active employee or contractor."},{status:400})
      if(access.role==="manager"&&!new Set(await listManagerWorkforceEmails(access.email)).has(target.email.toLowerCase()))return Response.json({error:"You can assign only people in your team."},{status:403})
      const changed=await setTimeProjectAssignment(body.projectId,target.email,body.assigned,access.email,getAuditContext(req))
      if(!changed)return Response.json({error:"Project is unavailable or the assignment did not change."},{status:404})
      return Response.json({ok:true})
    }
    if(access.role==="manager"&&!await isManagerProjectManager(access.email,body.projectId))return Response.json({error:"You can archive or restore only projects you manage."},{status:403})
    if(body.action==="assignment_status"){
      if(access.role==="manager"&&!new Set(await listManagerWorkforceEmails(access.email)).has(body.email.toLowerCase()))return Response.json({error:"You can manage only people in your team."},{status:403})
      const changed=await setTimeProjectAssignmentStatus(body.projectId,body.email,body.status,access.email,getAuditContext(req))
      return changed?Response.json({ok:true}):Response.json({error:"Assignment not found or already in that state."},{status:404})
    }
    if(body.action==="delete_unused"){
      const deleted=await deleteUnusedTimeProject(body.projectId,access.email,getAuditContext(req))
      return deleted?Response.json({ok:true}):Response.json({error:"Only projects with no timesheet use or assignment history can be deleted. Archive this project to preserve its records."},{status:409})
    }
    const project=await setTimeProjectActive(body.projectId,body.active,access.email,getAuditContext(req))
    return project?Response.json({project}):Response.json({error:"Project not found."},{status:404})
  }catch(error){
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Invalid project change."},{status:400})
    return Response.json({error:"Unable to save project changes."},{status:500})
  }
}

export const GET=withOperationalCapture("/api/projects","GET",getProjects)
export const POST=withOperationalCapture("/api/projects","POST",createProject)
export const PATCH=withOperationalCapture("/api/projects","PATCH",updateProject)
