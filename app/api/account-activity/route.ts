/** Returns a patron's own account and timesheet activity without admin-only metadata. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { acknowledgePatronAccountActivity, listPatronAccountActivity } from "@/lib/db"

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

export async function POST(request:Request) {
  try {
    const email=(await auth())?.user?.email
    const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const body=await request.json().catch(()=>null) as {eventId?:unknown}|null
    if(typeof body?.eventId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId)){
      return Response.json({error:"A valid activity event is required."},{status:400})
    }
    const acknowledged=await acknowledgePatronAccountActivity(email,body.eventId)
    if(!acknowledged)return Response.json({error:"Activity item was not found."},{status:404})
    return Response.json({acknowledged:true},{headers:{"Cache-Control":"no-store"}})
  } catch {
    return Response.json({error:"Could not acknowledge this activity item."},{status:503})
  }
}
