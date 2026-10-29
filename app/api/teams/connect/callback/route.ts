import { auth } from "@/auth"
import { callIntegrationApi } from "@/lib/integrations/http"
import { encryptTeamsTokenCache } from "@/lib/teams-transcript-connection-crypto"
import { saveTeamsTranscriptConnection } from "@/lib/teams-transcript-connections"
import { provisionOrganizerTranscriptSubscription } from "@/lib/teams-transcript-subscriptions"
import { readTeamsOAuthState } from "@/lib/teams-transcript-oauth-state"
import { TEAMS_GRAPH_SCOPES, teamsConfidentialClient, teamsConnectionReturnUrl, teamsEntraTenantId, teamsOAuthRedirectUri } from "@/lib/teams-transcript-msal"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const stateCookie = "tanovo-teams-oauth-state"

export async function GET(request: Request) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(stateCookie)?.value
  cookieStore.delete(stateCookie)
  const url = new URL(request.url)
  const stateValue = url.searchParams.get("state") ?? ""
  const state = cookieValue ? readTeamsOAuthState(cookieValue, stateValue) : null
  if (!state) return NextResponse.redirect(teamsConnectionReturnUrl("failed"))

  const session = await auth()
  if (session?.appSessionId !== state.appSessionId || session.user?.email?.trim().toLowerCase() !== state.ownerEmail) {
    return NextResponse.redirect(teamsConnectionReturnUrl("failed"))
  }
  if (url.searchParams.has("error") || !url.searchParams.get("code")) {
    return NextResponse.redirect(teamsConnectionReturnUrl("failed"))
  }

  try {
    const client = teamsConfidentialClient()
    const result = await client.acquireTokenByCode({
      code: url.searchParams.get("code")!,
      scopes: TEAMS_GRAPH_SCOPES,
      redirectUri: teamsOAuthRedirectUri(),
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.verifier,
    })
    const account = result.account
    const tenantId = teamsEntraTenantId()
    if (!result.accessToken || !account?.homeAccountId || account.tenantId?.toLowerCase() !== tenantId) {
      return NextResponse.redirect(teamsConnectionReturnUrl("failed"))
    }
    const graphIdentity = await callIntegrationApi<{ id: string }>({
      provider: "microsoft_graph",
      operation: "verify_connected_teams_account",
      path: "/me",
      method: "GET",
      accessToken: result.accessToken,
      query: { "$select": "id" },
    })
    if (graphIdentity.id.toLowerCase() !== account.localAccountId.toLowerCase()) {
      return NextResponse.redirect(teamsConnectionReturnUrl("failed"))
    }

    await saveTeamsTranscriptConnection({
      ownerEmail: state.ownerEmail,
      entraTenantId: tenantId,
      entraUserId: account.localAccountId,
      entraEmail: account.username,
      encryptedCache: encryptTeamsTokenCache(client.getTokenCache().serialize()),
      scopes: result.scopes,
    })

    try {
      await provisionOrganizerTranscriptSubscription({
        accessToken: result.accessToken,
        ownerEmail: state.ownerEmail,
        entraTenantId: tenantId,
        expectedOrganizerUserId: account.localAccountId,
      })
      return NextResponse.redirect(teamsConnectionReturnUrl("connected"))
    } catch {
      return NextResponse.redirect(teamsConnectionReturnUrl("subscription-pending"))
    }
  } catch {
    return NextResponse.redirect(teamsConnectionReturnUrl("failed"))
  }
}
