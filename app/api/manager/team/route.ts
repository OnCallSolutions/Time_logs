/** Returns only active employee/contractor identities assigned to the signed-in manager. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster } from "@/lib/collaboration"
import { listManagerWorkforceEmails } from "@/lib/db"

export const runtime="nodejs"

export async function GET():Promise<Response>{
  try{
    const email=(await auth())?.user?.email?.toLowerCase()
    const access=await getEffectivePermissions(email)
    if(!email||access.role!=="manager"||!access.permissions.view_team)return Response.json({error:"Team directory access is not available."},{status:403})
    const [assignedEmails,roster]=await Promise.all([listManagerWorkforceEmails(email),actorRoster()])
    const assigned=new Set(assignedEmails)
    const people=roster.filter(user=>assigned.has(user.email.toLowerCase())&&user.accessStatus==="active"&&(user.role==="employee"||user.role==="contractor"))
      .map(({email:personEmail,displayName,role,contractorNumber})=>({email:personEmail,displayName,role,contractorNumber:contractorNumber??null}))
    return Response.json({people},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Unable to load your team directory."},{status:500})
  }
}
