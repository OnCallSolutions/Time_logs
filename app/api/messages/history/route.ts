/**
 * Relays original ciphertext and signed history transfers for the signed-in account.
 * Public device keys are validated server-side; cross-account transfers are forbidden.
 * Ordinary users have no encryption controls or recovery secret to enter.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { publicMessageKeys } from "@/lib/message-keys"
import { historyPage, historyShares, saveHistoryShare } from "@/lib/message-history-store"
import { historyShareBytes } from "@/lib/message-history-crypto"
import { createPublicKey, verify } from "node:crypto"
import { z } from "zod"
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const encoded = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
export const historyShareSchema = z.object({ messageId: z.string().uuid(), sourceSignature: encoded.max(128), targetFingerprint: fingerprint, authorFingerprint: fingerprint, wrapped: encoded.max(1024), signature: encoded.max(128) }).strict()

/**
 * Returns an authorized history page and transfers for one registered own device.
 * @param request - Optional creation-order cursor and target fingerprint.
 * @returns Promise<Response> with fifty ciphertext records and the next cursor.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const owner = (await auth())?.user?.email, access = await getEffectivePermissions(owner)
    if (!owner || !access.role) return Response.json({ error: "Forbidden." }, { status: 403 })
    const params = new URL(request.url).searchParams
    const target = fingerprint.parse(params.get("device"))
    if (!(await publicMessageKeys([owner])).some(key => key.fingerprint === target)) return Response.json({ error: "Device unavailable." }, { status: 403 })
    const before = params.get("before") ? z.object({ date: z.string().datetime({ offset: true }), id: z.string().uuid() }).parse(JSON.parse(params.get("before")!)) : null
    const messages = await historyPage(owner, before, access.role === "contractor" || access.role === "employee")
    const last = messages.at(-1)
    return Response.json({ messages, shares: await historyShares(owner, target, messages.map(message => message.id)), next: messages.length === 50 && last ? { date: String(last.created_at), id: last.id } : null }, { headers: { "Cache-Control": "no-store" } })
  } catch { return Response.json({ error: "History unavailable." }, { status: 400 }) }
}
/**
 * Validates a signed own-device transfer without seeing any decrypted content.
 * @param request - At most fifty signed, revision-bound device shares.
 * @returns Promise<Response> with the number of unchanged transfers persisted.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const owner = (await auth())?.user?.email, access = await getEffectivePermissions(owner)
    if (!owner || !access.role) return Response.json({ error: "Forbidden." }, { status: 403 })
    const { shares } = z.object({ shares: z.array(historyShareSchema).min(1).max(50) }).strict().parse(await request.json())
    const keys = await publicMessageKeys([owner])
    for (const share of shares) {
      const author = keys.find(key => key.fingerprint === share.authorFingerprint)
      if (!author || !keys.some(key => key.fingerprint === share.targetFingerprint) || !verify("sha256", Buffer.from(historyShareBytes(owner, share)), { key: createPublicKey({ key: Buffer.from(author.signingKey, "base64"), format: "der", type: "spki" }), dsaEncoding: "ieee-p1363" }, Buffer.from(share.signature, "base64"))) return Response.json({ error: "Invalid device history transfer." }, { status: 403 })
    }
    let saved = 0
    for (const share of shares) if (await saveHistoryShare(owner, share)) saved++
    return Response.json({ saved })
  } catch { return Response.json({ error: "History sync unavailable." }, { status: 400 }) }
}
