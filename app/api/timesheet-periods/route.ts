/** Lists configured timesheet periods and lets authorized admins/account managers create them. */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { createTimesheetPeriod, listTimesheetPeriods, updateTimesheetPeriod } from "@/lib/db"

export const runtime = "nodejs"

const periodSchema = z.object({
  name: z.string().trim().min(2).max(100),
  startDate: z.string().date(),
  endDate: z.string().date(),
  submissionDeadline: z.string().datetime({ offset: true }),
  managerGraceDays: z.number().int().min(0).max(30),
  reminderDays: z.number().int().min(1).max(30),
}).strict()

export async function GET() {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role) return Response.json({ error: "Unauthorized." }, { status: 401 })
    return Response.json({ periods: await listTimesheetPeriods() }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Timesheet periods unavailable." }, { status: 503 })
  }
}

export async function POST(req: Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if (!access.permissions.manage_timesheet_periods) return Response.json({ error: "You are not authorized to configure timesheet periods." }, { status: 403 })
    const input = periodSchema.parse(await req.json())
    if (input.startDate > input.endDate) return Response.json({ error: "The period start must be on or before its end." }, { status: 400 })
    if (Date.parse(input.submissionDeadline) <= Date.now()) return Response.json({ error: "Choose a future submission deadline." }, { status: 400 })
    const period = await createTimesheetPeriod(input, email, getAuditContext(req))
    if (!period) return Response.json({ error: "This work-date range overlaps an existing period. Refresh periods and choose a non-overlapping range." }, { status: 409 })
    return Response.json({ period }, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    return Response.json({ error: invalid ? "Enter a valid period name, date range, deadline, grace, and reminder interval." : "Timesheet period could not be saved." }, { status: invalid ? 400 : 503 })
  }
}

/** Applies an audited period/deadline override; the explanation is required. */
export async function PATCH(req: Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if (!access.permissions.manage_timesheet_periods) return Response.json({ error: "You are not authorized to change timesheet periods." }, { status: 403 })
    const input = z.object({ id:z.string().uuid(), ...periodSchema.shape, reason:z.string().trim().min(5).max(500) }).strict().parse(await req.json())
    if (input.startDate > input.endDate) return Response.json({ error: "The period start must be on or before its end." }, { status: 400 })
    const { id, reason, ...period }=input
    const saved=await updateTimesheetPeriod(id,period,email,reason,getAuditContext(req))
    if (!saved) return Response.json({ error: "The period was not found or its dates overlap another period. Refresh and try again." }, { status: 409 })
    return Response.json({ period:saved }, { headers:{ "Cache-Control":"no-store" } })
  } catch (error) {
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    return Response.json({ error:invalid?"Enter valid period details and a reason for the change.":"Timesheet period could not be updated." }, { status:invalid?400:503 })
  }
}
