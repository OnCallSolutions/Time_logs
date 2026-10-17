/**
 * Creates official contractor/employee identities for managers and administrators.
 * Existing accounts cannot be overwritten or unblocked through onboarding.
 * Baseline creation does not accept elevated roles, permissions or caller-issued IDs.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getConfiguredAccessUsers, getEffectiveUserRole } from "@/lib/access"
import { listKnownUsers, recordAuditEvent } from "@/lib/db"
import { listAccountIdentities, onboardAccount, setOfficialIdentity } from "@/lib/account-identities"
import { emailSchema, officialNameSchema, employeeIdSchema } from "@/lib/identity-policy"
import { getAuditContext } from "@/lib/audit"

/** @returns Promise<Response> with official identity for the current authenticated account only. */
export async function GET(): Promise<Response> {
  const email = (await auth())?.user?.email
  if (!email || !await getEffectiveUserRole(email)) return Response.json({ error: "Forbidden." }, { status: 403 })
  return Response.json({ identity: (await listAccountIdentities([email]))[0] ?? null }, { headers: { "Cache-Control": "no-store" } })
}
/**
 * Adds a new person or permits an admin to correct an existing official name.
 * @param request - Strict official name/email/baseline-role payload, never permissions.
 * @returns Promise<Response> with immutable contractor number or a safe conflict.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = (await auth())?.user?.email, role = await getEffectiveUserRole(actor)
    if (!actor || (role !== "admin" && role !== "manager")) return Response.json({ error: "Forbidden." }, { status: 403 })
    const input = z.object({ email: emailSchema, officialName: officialNameSchema, employeeId: employeeIdSchema.optional(), role: z.enum(["contractor", "employee"]), correctExisting: z.boolean().optional() }).strict().parse(await request.json())
    const configured = getConfiguredAccessUsers()
    if (input.correctExisting && role !== "admin") return Response.json({ error: "Only an admin can correct an existing official identity." }, { status: 403 })
    if (!input.correctExisting && (configured.some(user => user.email.toLowerCase() === input.email) || (await listKnownUsers()).some(user => user.email.toLowerCase() === input.email))) return Response.json({ error: "This account already exists. Ask an admin to assign or correct its official identity." }, { status: 409 })
    if (input.correctExisting && !await getEffectiveUserRole(input.email)) return Response.json({ error: "Choose an existing active account." }, { status: 409 })
    const identity = input.correctExisting ? await setOfficialIdentity(input.email, input.officialName, actor, input.employeeId) : await onboardAccount({ ...input, actor, environmentAdmins: configured.filter(user => user.role === "admin" || user.role === "manager").map(user => user.email.toLowerCase()) })
    if (!identity) return Response.json({ error: "This account already exists or your access changed. Nothing was overwritten." }, { status: 409 })
    await recordAuditEvent({ actorEmail: actor, action: input.correctExisting ? "user_access_updated" : "user_access_created", targetType: "account_identity", targetId: input.email, metadata: { role: input.role, officialIdentity: true, correction: !!input.correctExisting, companyEmployeeIdAssigned: !!input.employeeId }, ...getAuditContext(request) })
    return Response.json({ identity }, { status: input.correctExisting ? 200 : 201 })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null
    return Response.json({ error: code === "23505" ? "That official name, email or identifier is already registered." : error instanceof z.ZodError ? "Use an official name of 2-80 letters and a valid email." : "Account creation was not confirmed. Refresh the directory before retrying." }, { status: code === "23505" ? 409 : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 })
  }
}
