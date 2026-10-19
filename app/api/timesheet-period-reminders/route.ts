/** Serves account-scoped deadline alerts and runs the authenticated scheduled sender. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getCurrentSubmissionCompliance, getTimesheetReminderPolicy, listTimesheetReminders, markTimesheetRemindersRead, sendDueTimesheetReminders, updateTimesheetReminderPolicy } from "@/lib/timesheet-period-reminders"
import { getAuditContext } from "@/lib/audit"

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
    return Response.json({reminders:await listTimesheetReminders(email),policy:access.permissions.manage_timesheet_reminders?await getTimesheetReminderPolicy():undefined,canViewCompliance:access.permissions.view_submission_compliance,compliance:access.permissions.view_submission_compliance?await getCurrentSubmissionCompliance():undefined},{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Timesheet reminders unavailable."},{status:503})}
}

export async function PATCH(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const body=await req.json()
    if(body&&typeof body==="object"&&!Array.isArray(body)&&"mode" in body){
      if(!access.permissions.manage_timesheet_reminders)return Response.json({error:"Reminder policy rights are required."},{status:403})
      const input=z.object({mode:z.enum(["automatic","manual"]),timezone:z.string().trim().min(3).max(80),workerInitialTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),workerHardTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),managerInitialTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),managerHardTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),accountManagerTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict().parse(body)
      try{new Intl.DateTimeFormat("en-US",{timeZone:input.timezone})}catch{return Response.json({error:"Choose a valid timezone."},{status:400})}
      const policy=await updateTimesheetReminderPolicy(input,email,getAuditContext(req))
      return Response.json({policy},{headers:{"Cache-Control":"no-store"}})
    }
    const input=readSchema.parse(body)
    await markTimesheetRemindersRead(email,input.ids)
    return Response.json({ok:true})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid notification selection.":"Could not update reminder state."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:503})}
}

export async function POST(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(!access.permissions.manage_timesheet_reminders)return Response.json({error:"Reminder policy rights are required."},{status:403})
    z.object({action:z.literal("send_due")}).strict().parse(await req.json())
    return Response.json({sent:await sendDueTimesheetReminders(true,email)},{headers:{"Cache-Control":"no-store"}})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid reminder action.":"Due reminders could not be sent."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:503})}
}
