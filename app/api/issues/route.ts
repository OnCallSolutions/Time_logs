import { z } from "zod"
import { createHash } from "node:crypto"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { recordAuditEvent } from "@/lib/db"
import { createIssue, getIssueSummary, listIssues, listReporterIssues, updateIssue, type IssueCategory, type IssuePriority, type IssueStatus } from "@/lib/issues-store"
import { readJsonLimited, RequestBodyTooLargeError } from "@/lib/read-json-limited"
import { withOperationalCapture } from "@/lib/api-outcome-capture"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const issueInput = z.object({
  reference: z.string().uuid(),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/i),
  route: z.string().regex(/^\/[a-zA-Z0-9/_\-[\]]{1,160}$/),
  status: z.number().int().min(400).max(599).optional(),
  message: z.string().min(1).max(400),
  details: z.string().max(3000).default(""),
  category:z.enum(["access","timesheet","project","messages","ai","integration","export","other"]).default("other"),
}).strict()
const updateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "investigating", "waiting_on_reporter", "resolved", "closed"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  internalNote: z.string().max(3000),
  category:z.enum(["access","timesheet","project","messages","ai","integration","export","other"]).default("other"),
  assignedTo:z.string().email().nullable().default(null),
  publicReply:z.string().max(2000).default(""),
}).strict()

function sanitizeMessage(message: string): string {
  return message.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240)
}
function sanitizeDetails(details: string): string {
  return details.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, 3000)
}

async function currentAdmin() {
  const email = (await auth())?.user?.email
  if (!email) return null
  const access = await getEffectivePermissions(email)
  return access.role === "admin" ? email : null
}

async function getIssues(request: Request) {
  try {
    const email = (await auth())?.user?.email
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if(new URL(request.url).searchParams.get("mine")==="1")return Response.json({issues:await listReporterIssues(email)},{headers:{"Cache-Control":"no-store"}})
    if (!(await currentAdmin())) return Response.json({ error: "Administrator access required." }, { status: 403 })
    const summaryOnly = new URL(request.url).searchParams.get("summary") === "1"
    const payload = summaryOnly ? { summary: await getIssueSummary() } : { issues: await listIssues() }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Issues could not be loaded." }, { status: 503 })
  }
}

async function createIssueReport(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 8192) return Response.json({ error: "Report is too large." }, { status: 413 })
    const email = (await auth())?.user?.email
    if (!email || !(await getEffectivePermissions(email)).role) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const input = issueInput.parse(await readJsonLimited(request, 8192))
    const errorMessage = sanitizeMessage(input.message)
    const signatureSource = [input.operation.toLowerCase(), input.route.toLowerCase(), input.status ?? "", errorMessage.toLowerCase().replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ").trim()].join("|")
    const errorSignature = createHash("sha256").update(signatureSource).digest("hex")
    const details = sanitizeDetails(input.details.trim())
    const saved = await createIssue({ reference: input.reference, reporterEmail: email, operation: input.operation, route: input.route, errorSignature, httpStatus: input.status ?? null, errorMessage, details,category:input.category as IssueCategory })
    if (!saved.ownerMatches) return Response.json({ error: "This failure reference is already associated with another report." }, { status: 409 })
    if (saved.created) await recordAuditEvent({ actorEmail: email, action: "user_issue_submitted", targetType: "app_issue", targetId: saved.issue.id, metadata: { reference: input.reference, operation: input.operation, route: input.route, httpStatus: input.status ?? null, errorMessage, reporterDetails: details, priority: saved.issue.priority, similarReports: saved.issue.similarReports }, ...getAuditContext(request) })
    return Response.json({ issue: { id: saved.issue.id, reference: saved.issue.reference, status: saved.issue.status }, created: saved.created }, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const tooLarge=error instanceof RequestBodyTooLargeError
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    return Response.json({ error: tooLarge?"Report is too large.":invalid ? "Invalid issue report." : "Issue report could not be saved." }, { status: tooLarge?413:invalid ? 400 : 503 })
  }
}

async function updateIssueReport(request: Request) {
  try {
    const email = await currentAdmin()
    if (!email) return Response.json({ error: "Administrator access required." }, { status: 403 })
    const input = updateInput.parse(await readJsonLimited(request, 8192))
    const before = (await listIssues()).find(issue => issue.id === input.id)
    if (!before) return Response.json({ error: "Issue not found." }, { status: 404 })
    if(input.assignedTo&&((await getEffectivePermissions(input.assignedTo)).role!=="admin"))return Response.json({error:"Assign support cases only to an active administrator."},{status:400})
    const issue = await updateIssue({ id: input.id, status: input.status as IssueStatus, priority: input.priority as IssuePriority, internalNote: input.internalNote.trim(), updatedBy: email,category:input.category as IssueCategory,assignedTo:input.assignedTo,publicReply:sanitizeDetails(input.publicReply.trim()) })
    if (!issue) return Response.json({ error: "Issue not found." }, { status: 404 })
    await recordAuditEvent({ actorEmail: email, action: "issue_updated", targetType: "app_issue", targetId: issue.id, metadata: { reference:issue.reference,previousStatus: before.status, status: issue.status, previousPriority: before.priority, priority: issue.priority,category:issue.category,assignedTo:issue.assignedTo,hasPublicReply:!!issue.publicReply,hasInternalNote:!!issue.internalNote }, ...getAuditContext(request) })
    return Response.json({ issue }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const tooLarge=error instanceof RequestBodyTooLargeError
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    return Response.json({ error: tooLarge?"Request is too large.":invalid ? "Invalid issue update." : "Issue update could not be saved." }, { status: tooLarge?413:invalid ? 400 : 503 })
  }
}

export const GET=withOperationalCapture("/api/issues","GET",getIssues)
export const POST=withOperationalCapture("/api/issues","POST",createIssueReport)
export const PATCH=withOperationalCapture("/api/issues","PATCH",updateIssueReport)
