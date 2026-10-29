import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export type TeamsOAuthState = {
  state: string
  verifier: string
  nonce: string
  appSessionId: string
  ownerEmail: string
  createdAt: number
}

function signingSecret() {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be configured to connect Microsoft Teams.")
  return value
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url")
}

export function createTeamsOAuthState(input: Omit<TeamsOAuthState, "state" | "verifier" | "nonce" | "createdAt">): { value: string; state: string; verifier: string; nonce: string } {
  const state = randomBytes(32).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const nonce = randomBytes(32).toString("base64url")
  const payload = Buffer.from(JSON.stringify({ ...input, state, verifier, nonce, createdAt: Date.now() } satisfies TeamsOAuthState)).toString("base64url")
  const signed = `${payload}.${sign(payload)}`
  return { value: signed, state, verifier, nonce }
}

export function readTeamsOAuthState(value: string, expectedState: string): TeamsOAuthState | null {
  const [payload, signature, extra] = value.split(".")
  if (!payload || !signature || extra !== undefined) return null
  const actual = Buffer.from(signature, "base64url")
  const expected = Buffer.from(sign(payload), "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TeamsOAuthState
    if (parsed.state !== expectedState || Date.now() - parsed.createdAt > 10 * 60 * 1000 || parsed.createdAt > Date.now() + 30_000) return null
    if (!/^[a-f0-9-]{36}$/i.test(parsed.appSessionId) || !parsed.ownerEmail.includes("@") || parsed.verifier.length < 43 || parsed.nonce.length < 32) return null
    return parsed
  } catch {
    return null
  }
}
