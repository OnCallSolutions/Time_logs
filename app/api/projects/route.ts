import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { actorRoster,employeeRoster } from "@/lib/collaboration"
import { createTimeProject, listTimeProjectAssignmentHistory, listTimeProjectAssignments, listTimeProjects, setTimeProjectActive, setTimeProjectAssignment } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { resolvePatronManager } from "@/lib/submission-reviewer"

export const runtime="nodejs"

async function currentAccess(){
  const email=(await auth())?.user?.email?.toLowerCase()??null
  const {role,permissions}=await getEffectivePermissions(email)
  return email&&role?{email,role,permissions}:null
}

export async function GET(){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    const manager=(access.role==="admin"||access.role==="manager"||access.role==="account_manager")&&access.permissions.manage_projects
    const projects=await listTimeProjects(manager,manager?undefined:access.email)
    const assignments=manager?await listTimeProjectAssignments():[]
    const assignmentHistory=manager?await listTimeProjectAssignmentHistory():[]
    const assignedManagers=new Set(assignments.map(item=>item.email.toLowerCase()))
    const patrons=manager?(await actorRoster()).filter(user=>user.accessStatus==="active"&&((user.role==="employee"||user.role==="contractor")||((user.role==="manager"||user.role==="account_manager")&&assignedManagers.has(user.email.toLowerCase())))).map(user=>({email:user.email,displayName:user.displayName,role:user.role})):[]
    return Response.json({projects,assignments,assignmentHistory,patrons},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Unable to load assigned projects."},{status:500})
  }
}

export async function POST(req:Request){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    const mayCreate=(access.role==="admin"||access.role==="manager"||access.role==="account_manager")&&access.permissions.manage_projects||((access.role==="contractor"||access.role==="employee")&&access.permissions.create_projects)
    if(!mayCreate)return Response.json({error:"A manager must grant you project-creation permission first."},{status:403})
    const body=z.object({name:z.string().trim().min(1).max(120),description:z.string().trim().max(500).default("")}).strict().parse(await req.json())
    const assignCreator=access.role==="contractor"||access.role==="employee"
    const manager=assignCreator?await resolvePatronManager(access.email):null
    const project=manager
      ?await createTimeProject(body,access.email,getAuditContext(req),assignCreator,manager.email)
      :await createTimeProject(body,access.email,getAuditContext(req),assignCreator)
    if(!project)return Response.json({error:"A project with that name already exists."},{status:409})
    return Response.json({project},{status:201})
  }catch(error){
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Enter a valid project name and description."},{status:400})
    return Response.json({error:"Unable to create project."},{status:500})
  }
}

export async function PATCH(req:Request){
  try{
    const access=await currentAccess()
    if(!access)return Response.json({error:"Unauthorized."},{status:401})
    if(!["admin","manager","account_manager"].includes(access.role)||!access.permissions.manage_projects)return Response.json({error:"Project management rights are required to assign or archive projects."},{status:403})
    const body=z.discriminatedUnion("action",[
      z.object({action:z.literal("assignment"),projectId:z.string().uuid(),email:z.string().email(),assigned:z.boolean()}),
      z.object({action:z.literal("status"),projectId:z.string().uuid(),active:z.boolean()}),
    ]).parse(await req.json())
    if(body.action==="assignment"){
      const target=(await employeeRoster()).find(user=>user.email.toLowerCase()===body.email.toLowerCase())
      if(!target||!(target.role==="employee"||target.role==="contractor"))return Response.json({error:"Choose an active employee or contractor."},{status:400})
      const changed=await setTimeProjectAssignment(body.projectId,target.email,body.assigned,access.email,getAuditContext(req))
      if(!changed)return Response.json({error:"Project is unavailable or the assignment did not change."},{status:404})
      return Response.json({ok:true})
    }
    const project=await setTimeProjectActive(body.projectId,body.active,access.email,getAuditContext(req))
    return project?Response.json({project}):Response.json({error:"Project not found."},{status:404})
  }catch(error){
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Invalid project change."},{status:400})
    return Response.json({error:"Unable to save project changes."},{status:500})
  }
}
