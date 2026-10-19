/** Lists configured timesheet periods and lets authorized admins/account managers create them. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { persistenceFailureDetails } from "@/lib/persistence-diagnostics"
import { createTimesheetPeriod, listTimesheetPeriodScheduleIssues, listTimesheetPeriods, reconcileTimesheetPeriodSchedule, updateTimesheetPeriod } from "@/lib/db"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

export const runtime = "nodejs"

const periodSchema = z.object({
  name: z.string().trim().min(2).max(100),
  startDate: z.string().date(),
  endDate: z.string().date(),
  submissionDeadline: z.string().datetime({ offset: true }),
  managerSubmissionDeadline: z.string().datetime({offset:true}).optional(),
  accountApprovalDeadline: z.string().datetime({offset:true}).optional(),
  exceptionResolutionDeadline: z.string().datetime({offset:true}).optional(),
  timezone: z.string().trim().min(3).max(80).default("America/New_York"),
  managerGraceDays: z.number().int().min(0).max(30),
  reminderDays: z.number().int().min(1).max(30),
}).strict()

function deadlineOrderIsValid(input:{submissionDeadline:string;managerSubmissionDeadline?:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string}){
  const worker=Date.parse(input.submissionDeadline)
  const manager=Date.parse(input.managerSubmissionDeadline??new Date(worker+2*86_400_000).toISOString())
  const accounts=Date.parse(input.accountApprovalDeadline??new Date(worker+3*86_400_000).toISOString())
  const resolution=Date.parse(input.exceptionResolutionDeadline??new Date(worker+4*86_400_000).toISOString())
  return worker<manager&&manager<accounts&&accounts<=resolution
}

async function getTimesheetPeriods(request:Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if(access.permissions.manage_timesheet_periods)await reconcileTimesheetPeriodSchedule(getAuditContext(request))
    return Response.json({ periods: await listTimesheetPeriods(), scheduleIssues: await listTimesheetPeriodScheduleIssues() }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Timesheet periods unavailable." }, { status: 503 })
  }
}

async function createTimesheetPeriodHandler(req: Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if (!access.permissions.manage_timesheet_periods) return Response.json({ error: "You are not authorized to configure timesheet periods." }, { status: 403 })
    const input = periodSchema.parse(await req.json())
    if (input.startDate > input.endDate) return Response.json({ error: "The period start must be on or before its end." }, { status: 400 })
    if(!deadlineOrderIsValid(input))return Response.json({error:"Deadlines must run in order: employee/contractor, manager, account approval, then issue resolution."},{status:400})
    if (input.endDate < new Date().toISOString().slice(0,10)) return Response.json({ error: "Past periods are archived. New periods must include today or a future date." }, { status: 400 })
    if (Date.parse(input.submissionDeadline) <= Date.now()) return Response.json({ error: "Choose a future submission deadline." }, { status: 400 })
    const period = await createTimesheetPeriod(input, email, getAuditContext(req))
    if (!period) return Response.json({ error: "This work-date range overlaps an existing period. Refresh periods and choose a non-overlapping range." }, { status: 409 })
    return Response.json({ period }, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    if (!invalid) console.error("[timesheet-periods] create failed", persistenceFailureDetails(error))
    return Response.json({ error: invalid ? "Enter a valid period name, date range, deadline, grace, and reminder interval." : "Timesheet period could not be saved." }, { status: invalid ? 400 : 503 })
  }
}

/** Applies an audited period/deadline override; the explanation is required. */
async function updateTimesheetPeriodHandler(req: Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if (!access.permissions.manage_timesheet_periods) return Response.json({ error: "You are not authorized to change timesheet periods." }, { status: 403 })
    const input = z.object({ id:z.string().uuid(), ...periodSchema.shape, reason:z.string().trim().min(5).max(500) }).strict().parse(await req.json())
    if (input.startDate > input.endDate) return Response.json({ error: "The period start must be on or before its end." }, { status: 400 })
    if(!deadlineOrderIsValid(input))return Response.json({error:"Deadlines must run in order: employee/contractor, manager, account approval, then issue resolution."},{status:400})
    if (input.endDate < new Date().toISOString().slice(0,10)) return Response.json({ error: "Past periods are archived and cannot be edited." }, { status: 409 })
    const { id, reason, ...period }=input
    const saved=await updateTimesheetPeriod(id,period,email,reason,getAuditContext(req))
    if (!saved) return Response.json({ error: "The period was not found or its dates overlap another period. Refresh and try again." }, { status: 409 })
    return Response.json({ period:saved }, { headers:{ "Cache-Control":"no-store" } })
  } catch (error) {
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    if(!invalid)console.error("[timesheet-periods] update failed",persistenceFailureDetails(error))
    return Response.json({ error:invalid?"Enter valid period details and a reason for the change.":"Timesheet period could not be updated." }, { status:invalid?400:503 })
  }
}

export const GET=withOperationalCapture("/api/timesheet-periods","GET",getTimesheetPeriods)
export const POST=withOperationalCapture("/api/timesheet-periods","POST",createTimesheetPeriodHandler)
export const PATCH=withOperationalCapture("/api/timesheet-periods","PATCH",updateTimesheetPeriodHandler)
