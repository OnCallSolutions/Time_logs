import "server-only"
import { ConfidentialClientApplication } from "@azure/msal-node"
import { apiPath } from "@/lib/paths"

export const TEAMS_GRAPH_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadBasic", "OnlineMeetings.Read", "OnlineMeetingTranscript.Read.All", "OnlineMeetingArtifact.Read.All"]

export function teamsEntraTenantId() {
  const value = process.env.TEAMS_ENTRA_TENANT_ID
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("TEAMS_ENTRA_TENANT_ID must be a configured Entra tenant ID.")
  }
  return value.toLowerCase()
}

export function teamsOAuthRedirectUri() {
  const value = process.env.TEAMS_OAUTH_REDIRECT_URI
  if (!value) throw new Error("TEAMS_OAUTH_REDIRECT_URI is not configured.")
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Teams OAuth requires HTTPS outside localhost.")
  if (url.pathname !== apiPath("/api/teams/connect/callback") || url.search || url.hash || url.username || url.password) {
    throw new Error(`TEAMS_OAUTH_REDIRECT_URI must use the exact callback path ${apiPath("/api/teams/connect/callback")}.`)
  }
  return url.toString()
}

export function teamsConfidentialClient() {
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
  if (!clientId || !clientSecret) throw new Error("Microsoft Entra client credentials are not configured.")
  return new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${teamsEntraTenantId()}`,
    },
  })
}

export function teamsConnectionReturnUrl(status: "connected" | "subscription-pending" | "failed") {
  const redirectUri = new URL(teamsOAuthRedirectUri())
  const result = new URL(apiPath("/"), redirectUri.origin)
  result.searchParams.set("teamsConnection", status)
  return result
}
