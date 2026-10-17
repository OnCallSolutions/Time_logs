/** Serves account-scoped deadline alerts and runs the authenticated scheduled sender. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listTimesheetReminders, markTimesheetRemindersRead, sendDueTimesheetReminders } from "@/lib/timesheet-period-reminders"

export const runtime="nodejs"
const readSchema=z.object({ids:z.array(z.string().uuid()).min(1).max(100)}).strict()

export async function GET(req:Request){
  try{
    if(new URL(req.url).searchParams.get("scheduled")==="1"){
      if(!process.env.CRON_SECRET||req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:"Unauthorized."},{status:401})
      return Response.json({sent:await sendDueTimesheetReminders()})
    }
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    return Response.json({reminders:await listTimesheetReminders(email)},{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Timesheet reminders unavailable."},{status:503})}
}

export async function PATCH(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const input=readSchema.parse(await req.json())
    await markTimesheetRemindersRead(email,input.ids)
    return Response.json({ok:true})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid notification selection.":"Could not update reminder state."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:503})}
}
