/** Returns a patron's own account and timesheet activity without admin-only metadata. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listPatronAccountActivity } from "@/lib/db"

export const runtime = "nodejs"

export async function GET() {
  try {
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const events=await listPatronAccountActivity(email)
    return Response.json({events},{headers:{"Cache-Control":"no-store"}})
  } catch {
    return Response.json({error:"Account activity is unavailable."},{status:503})
  }
}
