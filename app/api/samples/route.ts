/**
 * Provides clearly synthetic timesheet examples scoped to authenticated roles.
 * Personal examples use only the signed-in name and preserve repeated projects.
 * Account-manager examples are previews only and never persist timesheet records.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAccountIdentities } from "@/lib/account-identities"
import { randomInt } from "node:crypto"
/**
 * Returns role-specific sample notes without accepting client-supplied identities.
 * @param request - Optional fixed count for repeatable tests, or random (3-18) by default.
 * @returns Promise<Response> containing synthetic notes, or validation/access failure.
 */
export async function GET(request?: Request):Promise<Response>{
  const session=await auth(),email=session?.user?.email
  const access=await getEffectivePermissions(email)
  if(!email||!access.role||!(access.permissions.create_entries||(access.role==="account_manager"&&access.permissions.view_accounts)))return Response.json({error:"Sample access is not permitted."},{status:403})
  const requested=request ? new URL(request.url).searchParams.get("count") ?? "random" : "random"
  const count=requested==="random"?randomInt(3,19):Number(requested)
  if(requested!=="random"&&![3,6,12].includes(count))return Response.json({error:"Choose random, 3, 6, or 12 sample entries per person."},{status:400})
  const identity=(await listAccountIdentities([email]))[0]
  const names=access.role==="account_manager"?["Sample Contractor A","Sample Employee B"]:[identity?.officialName||session?.user?.name?.trim()||email]
  const today=new Date()
  const tasks=["documentation task","testing task","implementation task"]
  const notes=names.flatMap(name=>Array.from({length:count},(_,index)=>{
    const date=new Date(today)
    date.setUTCDate(today.getUTCDate()-Math.floor(index/3))
    const project=Math.floor(index/6)%2===0?"Sample Project":"Sample Integration"
    return `${name}: ${date.toISOString().slice(0,10)}, ${[1.5,2,0.75][index%3]} hours on ${project}, ${tasks[index%3]}.`
  })).join("\n")
  return Response.json({notes,count,synthetic:true,previewOnly:access.role==="account_manager"},{headers:{"Cache-Control":"no-store"}})
}
