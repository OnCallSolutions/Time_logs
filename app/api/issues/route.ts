import { z } from "zod"
import { createHash } from "node:crypto"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAuditContext } from "@/lib/audit"
import { recordAuditEvent } from "@/lib/db"
import { createIssue, getIssueSummary, listIssues, updateIssue, type IssuePriority, type IssueStatus } from "@/lib/issues-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const issueInput = z.object({
  reference: z.string().uuid(),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/i),
  route: z.string().regex(/^\/[a-zA-Z0-9/_\-[\]]{1,160}$/),
  status: z.number().int().min(400).max(599).optional(),
  message: z.string().min(1).max(400),
  details: z.string().max(3000).default(""),
}).strict()
const updateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "investigating", "waiting_on_reporter", "resolved", "closed"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  internalNote: z.string().max(3000),
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

export async function GET(request: Request) {
  try {
    const email = (await auth())?.user?.email
    if (!email) return Response.json({ error: "Unauthorized." }, { status: 401 })
    if (!(await currentAdmin())) return Response.json({ error: "Administrator access required." }, { status: 403 })
    const summaryOnly = new URL(request.url).searchParams.get("summary") === "1"
    const payload = summaryOnly ? { summary: await getIssueSummary() } : { issues: await listIssues() }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Issues could not be loaded." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 8192) return Response.json({ error: "Report is too large." }, { status: 413 })
    const email = (await auth())?.user?.email
    if (!email || !(await getEffectivePermissions(email)).role) return Response.json({ error: "Unauthorized." }, { status: 401 })
    const input = issueInput.parse(await request.json())
    const errorMessage = sanitizeMessage(input.message)
    const signatureSource = [input.operation.toLowerCase(), input.route.toLowerCase(), input.status ?? "", errorMessage.toLowerCase().replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ").trim()].join("|")
    const errorSignature = createHash("sha256").update(signatureSource).digest("hex")
    const details = sanitizeDetails(input.details.trim())
    const saved = await createIssue({ reference: input.reference, reporterEmail: email, operation: input.operation, route: input.route, errorSignature, httpStatus: input.status ?? null, errorMessage, details })
    if (!saved.ownerMatches) return Response.json({ error: "This failure reference is already associated with another report." }, { status: 409 })
    if (saved.created) await recordAuditEvent({ actorEmail: email, action: "user_issue_submitted", targetType: "app_issue", targetId: saved.issue.id, metadata: { reference: input.reference, operation: input.operation, route: input.route, httpStatus: input.status ?? null, errorMessage, reporterDetails: details, priority: saved.issue.priority, similarReports: saved.issue.similarReports }, ...getAuditContext(request) })
    return Response.json({ issue: { id: saved.issue.id, reference: saved.issue.reference, status: saved.issue.status }, created: saved.created }, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    return Response.json({ error: invalid ? "Invalid issue report." : "Issue report could not be saved." }, { status: invalid ? 400 : 503 })
  }
}

export async function PATCH(request: Request) {
  try {
    const email = await currentAdmin()
    if (!email) return Response.json({ error: "Administrator access required." }, { status: 403 })
    const input = updateInput.parse(await request.json())
    const before = (await listIssues()).find(issue => issue.id === input.id)
    if (!before) return Response.json({ error: "Issue not found." }, { status: 404 })
    const issue = await updateIssue({ id: input.id, status: input.status as IssueStatus, priority: input.priority as IssuePriority, internalNote: input.internalNote.trim(), updatedBy: email })
    if (!issue) return Response.json({ error: "Issue not found." }, { status: 404 })
    await recordAuditEvent({ actorEmail: email, action: "issue_updated", targetType: "app_issue", targetId: issue.id, metadata: { previousStatus: before.status, status: issue.status, previousPriority: before.priority, priority: issue.priority, internalNote: issue.internalNote }, ...getAuditContext(request) })
    return Response.json({ issue }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    return Response.json({ error: invalid ? "Invalid issue update." : "Issue update could not be saved." }, { status: invalid ? 400 : 503 })
  }
}
