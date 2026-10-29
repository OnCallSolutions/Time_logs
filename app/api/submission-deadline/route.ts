/** Provides the organization-wide hard deadline for submitting timesheets. */
import { z } from "zod"
import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { getTimesheetSubmissionDeadline, setTimesheetSubmissionDeadline } from "@/lib/db"

export const runtime = "nodejs"

const updateSchema = z.object({
  deadline: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(500),
}).strict()

/** Returns the submission boundary to signed-in organization patrons. */
async function getSubmissionDeadline() {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || !access.role) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const deadline = await getTimesheetSubmissionDeadline()
    return Response.json({ deadline, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Submission deadline unavailable." }, { status: 500 })
  }
}

/** Allows only administrators to set a future hard deadline; the database audits it atomically. */
async function updateSubmissionDeadline(req: Request) {
  try {
    const email = (await auth())?.user?.email
    const access = await getEffectivePermissions(email)
    if (!email || access.role !== "admin") return Response.json({ error: "Only administrators can set the organization submission deadline." }, { status: 403 })
    const input = updateSchema.parse(await req.json())
    if (Date.parse(input.deadline) <= Date.now()) return Response.json({ error: "Choose a future submission deadline." }, { status: 400 })
    const deadline = await setTimesheetSubmissionDeadline(input.deadline, email, input.reason, getAuditContext(req))
    return Response.json({ deadline }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "Enter a valid future deadline and a short reason." : "Submission deadline could not be saved." }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 })
  }
}

export const GET=withOperationalCapture("/api/submission-deadline","GET",getSubmissionDeadline)
export const PATCH=withOperationalCapture("/api/submission-deadline","PATCH",updateSubmissionDeadline)
