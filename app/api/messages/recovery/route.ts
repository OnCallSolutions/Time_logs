/**
 * Exposes audited, administrator-only organization recovery for registered devices.
 * Recovery rewraps existing content keys; it cannot recover unenrolled past history.
 * Neither message plaintext nor organization private keys are returned by this API.
 */
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { publicMessageKeys } from "@/lib/message-keys"
import { historyPage, historyShares, saveHistoryShare } from "@/lib/message-history-store"
import { organizationRecoveryKeys, recoverHistoryKey } from "@/lib/message-organization-recovery"
import { historyShareBytes } from "@/lib/message-history-crypto"
import { recordAuditEvent } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
import { emailSchema } from "@/lib/identity-policy"
import { createPublicKey, verify } from "node:crypto"
import { z } from "zod"

/**
 * Lists a selected active account's recovery targets for administrators only.
 * @param request - Account email, not a client-supplied role or key.
 * @returns Promise<Response> with configuration state and public device labels.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = (await auth())?.user?.email
    if (!actor || await getEffectiveUserRole(actor) !== "admin") return Response.json({ error: "Forbidden." }, { status: 403 })
    const email = emailSchema.parse(new URL(request.url).searchParams.get("email"))
    if (!await getEffectiveUserRole(email)) return Response.json({ error: "Choose an active account." }, { status: 400 })
    return Response.json({ configured: organizationRecoveryKeys([email]).length > 0, devices: (await publicMessageKeys([email])).filter(key => key.deviceId && key.deviceId !== "organization-recovery").map(key => ({ deviceId: key.deviceId, fingerprint: key.fingerprint })) }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Recovery configuration unavailable." }, { status: 503 }) }
}
/**
 * Restores one bounded page to a registered target and records administrator action.
 * @param request - Active account email, existing target fingerprint and optional cursor.
 * @returns Promise<Response> with restored/unavailable counts and next-page cursor.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = (await auth())?.user?.email
    if (!actor || await getEffectiveUserRole(actor) !== "admin") return Response.json({ error: "Forbidden." }, { status: 403 })
    const input = z.object({ email: emailSchema, target: z.string().regex(/^[a-f0-9]{64}$/), before: z.object({ date: z.string().datetime({ offset: true }), id: z.string().uuid() }).nullable().optional() }).strict().parse(await request.json())
    const role = await getEffectiveUserRole(input.email)
    if (!role) return Response.json({ error: "Choose an active account." }, { status: 400 })
    const keys = await publicMessageKeys([input.email]), target = keys.find(key => key.fingerprint === input.target && key.deviceId && key.deviceId !== "organization-recovery")
    const recovery = organizationRecoveryKeys([input.email])[0]
    if (!target || !recovery) return Response.json({ error: "Recovery must be configured and the destination device registered." }, { status: 409 })
    const messages = await historyPage(input.email, input.before ?? null, role === "employee" || role === "contractor")
    const relays = await historyShares(input.email, recovery.fingerprint, messages.map(message => message.id))
    // Audit the intent before using the organization's private recovery capability.
    await recordAuditEvent({ actorEmail: actor, action: "message_history_recovered", targetType: "message_device", targetId: target.deviceId!, metadata: { owner: input.email, target: target.fingerprint, pageSize: messages.length, phase: "requested" }, ...getAuditContext(request) })
    let restored = 0, unavailable = 0
    for (const message of messages) {
      const payload = message.encrypted_payload
      if (!payload || message.deleted_at) continue
      const native = payload.version === 2 ? payload.keys[input.email]?.devices?.[recovery.fingerprint] : undefined
      const relay = relays.find(share => share.messageId === message.id)
      let wrapped = native
      if (!wrapped && relay) {
        const source = keys.find(key => key.fingerprint === relay.authorFingerprint)
        if (source && verify("sha256", Buffer.from(historyShareBytes(input.email, relay)), { key: createPublicKey({ key: Buffer.from(source.signingKey, "base64"), type: "spki", format: "der" }), dsaEncoding: "ieee-p1363" }, Buffer.from(relay.signature, "base64"))) wrapped = relay.wrapped
      }
      if (!wrapped) { unavailable++; continue }
      if (await saveHistoryShare(input.email, recoverHistoryKey(input.email, message.id, payload.signature, wrapped, target))) restored++
    }
    await recordAuditEvent({ actorEmail: actor, action: "message_history_recovered", targetType: "message_device", targetId: target.deviceId!, metadata: { owner: input.email, restored, unavailable, phase: "completed" }, ...getAuditContext(request) })
    const last = messages.at(-1)
    return Response.json({ restored, unavailable, next: messages.length === 50 && last ? { date: String(last.created_at), id: last.id } : null }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "Recovery was not confirmed. Refresh before retrying." }, { status: 503 }) }
}
