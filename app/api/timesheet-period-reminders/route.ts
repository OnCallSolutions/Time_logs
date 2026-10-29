/** Serves account-scoped deadline alerts and runs the authenticated scheduled sender. */
import { z } from "zod"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getCurrentSubmissionCompliance, getTimesheetReminderPolicy, listTimesheetReminders, markTimesheetRemindersRead, sendDueTimesheetReminders, updateTimesheetReminderPolicy } from "@/lib/timesheet-period-reminders"
import { getAuditContext } from "@/lib/audit"
import { listTimesheetPeriodScheduleIssues, listTimesheetPeriods, reconcileTimesheetPeriodSchedule } from "@/lib/db"

export const runtime="nodejs"
const readSchema=z.object({ids:z.array(z.string().uuid()).min(1).max(100)}).strict()

async function getPeriodReminders(req:Request){
  try{
    if(new URL(req.url).searchParams.get("scheduled")==="1"){
      if(!process.env.CRON_SECRET||req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:"Unauthorized."},{status:401})
      await reconcileTimesheetPeriodSchedule(getAuditContext(req))
      return Response.json({sent:await sendDueTimesheetReminders()})
    }
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    const policy=await getTimesheetReminderPolicy()
    const periods=await listTimesheetPeriods()
    return Response.json({
      reminders:await listTimesheetReminders(email),
      policy:{mode:policy.mode,timezone:policy.timezone,workerInitialTime:policy.workerInitialTime,workerHardTime:policy.workerHardTime,managerInitialTime:policy.managerInitialTime,managerHardTime:policy.managerHardTime,accountManagerTime:policy.accountManagerTime},
      canManagePolicy:access.permissions.manage_timesheet_reminders,
      canManagePeriods:access.permissions.manage_timesheet_periods,
      canViewCompliance:access.permissions.view_submission_compliance,
      scheduleIssues:await listTimesheetPeriodScheduleIssues(),
      periods:periods.map(({id,name,startDate,endDate,submissionDeadline,managerSubmissionDeadline,accountApprovalDeadline,exceptionResolutionDeadline,timezone,reminderDays})=>({id,name,startDate,endDate,submissionDeadline,managerSubmissionDeadline,accountApprovalDeadline,exceptionResolutionDeadline,timezone,reminderDays})),
      compliance:access.permissions.view_submission_compliance?await getCurrentSubmissionCompliance():undefined,
    },{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Timesheet reminders unavailable."},{status:503})}
}

async function updatePeriodReminders(req:Request){
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

async function sendPeriodReminders(req:Request){
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Unauthorized."},{status:401})
    if(!access.permissions.manage_timesheet_reminders)return Response.json({error:"Reminder policy rights are required."},{status:403})
    z.object({action:z.literal("send_due")}).strict().parse(await req.json())
    return Response.json({sent:await sendDueTimesheetReminders(true,email)},{headers:{"Cache-Control":"no-store"}})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid reminder action.":"Due reminders could not be sent."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:503})}
}

export const GET=withOperationalCapture("/api/timesheet-period-reminders","GET",getPeriodReminders)
export const PATCH=withOperationalCapture("/api/timesheet-period-reminders","PATCH",updatePeriodReminders)
export const POST=withOperationalCapture("/api/timesheet-period-reminders","POST",sendPeriodReminders)
