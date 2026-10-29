/** Returns an actor-scoped archive of audited manager rejection decisions. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listEntryRejections } from "@/lib/db"

export const runtime="nodejs"

export async function GET(){
  try{
    const email=(await auth())?.user?.email?.trim().toLowerCase()
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(access.role!=="admin"&&!(access.role==="manager"&&(access.permissions.review_entries||access.permissions.review_manager_entries)))return Response.json({error:"Forbidden."},{status:403})
    const rejections=await listEntryRejections(access.role==="admin"?null:email)
    return Response.json({rejections},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return Response.json({error:"Rejection archive unavailable."},{status:503})
  }
}
