/**
 * Provides clearly synthetic timesheet examples scoped to authenticated roles.
 * Personal examples use only the signed-in name and preserve repeated projects.
 * Account-manager examples are previews only and never persist timesheet records.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
/**
 * Returns role-specific sample notes without accepting client-supplied identities.
 * @returns Promise<Response> containing synthetic notes, or a permission failure.
 */
export async function GET():Promise<Response>{
  const session=await auth(),email=session?.user?.email
  const access=await getEffectivePermissions(email)
  if(!email||!access.role||!(access.permissions.create_entries||(access.role==="account_manager"&&access.permissions.view_accounts)))return Response.json({error:"Sample access is not permitted."},{status:403})
  const names=access.role==="account_manager"?["Sample Contractor A","Sample Employee B"]:[session?.user?.name?.trim()||email]
  const date=new Date().toISOString().slice(0,10)
  const notes=names.map(name=>`${name}: ${date}, 2 hours on Sample Project, documentation task.\n${name}: ${date}, 3 hours on Sample Project, testing task.`).join("\n")
  return Response.json({notes,synthetic:true,previewOnly:access.role==="account_manager"},{headers:{"Cache-Control":"no-store"}})
}
