import { auth } from "@/auth"
import { apiPath } from "@/lib/paths"
import { createTeamsOAuthState } from "@/lib/teams-transcript-oauth-state"
import { TEAMS_GRAPH_SCOPES, teamsConfidentialClient, teamsOAuthRedirectUri } from "@/lib/teams-transcript-msal"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createHash } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const stateCookie = "tanovo-teams-oauth-state"

export async function GET() {
  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email || !session?.appSessionId) return Response.json({ error: "Sign in before connecting Teams." }, { status: 401 })

  try {
    const redirectUri = teamsOAuthRedirectUri()
    const client = teamsConfidentialClient()
    const state = createTeamsOAuthState({ appSessionId: session.appSessionId, ownerEmail: email })
    const codeChallenge = createHash("sha256").update(state.verifier).digest("base64url")
    const authorizationUrl = await client.getAuthCodeUrl({
      scopes: TEAMS_GRAPH_SCOPES,
      redirectUri,
      state: state.state,
      nonce: state.nonce,
      responseMode: "query",
      prompt: "select_account",
      codeChallenge,
      codeChallengeMethod: "S256",
    })
    const cookieStore = await cookies()
    cookieStore.set(stateCookie, state.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: apiPath("/api/teams/connect"),
      maxAge: 10 * 60,
    })
    return NextResponse.redirect(authorizationUrl, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Teams connection is not configured yet." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
