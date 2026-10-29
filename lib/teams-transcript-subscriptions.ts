import "server-only"
import { randomBytes } from "node:crypto"
import { callIntegrationApi } from "@/lib/integrations/http"
import { listTeamsTranscriptSubscriptionsForRenewal, saveTeamsTranscriptSubscription, updateTeamsTranscriptSubscriptionExpiry } from "@/lib/teams-transcript-inbox"
import { getTeamsTranscriptAccessToken } from "@/lib/teams-transcript-connections"

// Keep expiry under one hour so Graph does not require lifecycleNotificationUrl.
// The protected five-minute renewal schedule keeps active subscriptions alive.
const SUBSCRIPTION_LIFETIME_MINUTES = 50

type GraphMe = {
  id: string
  userPrincipalName?: string
  mail?: string | null
}

type GraphSubscription = {
  id: string
  expirationDateTime: string
  resource: string
}

function requireUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a verified Entra object ID.`)
  }
}

function transcriptNotificationUrl() {
  const value = process.env.TEAMS_TRANSCRIPT_NOTIFICATION_URL
  if (!value) throw new Error("TEAMS_TRANSCRIPT_NOTIFICATION_URL is not configured.")
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Teams transcript notifications require a public HTTPS endpoint URL.")
  }
  return url.toString()
}

/** Creates a least-scope organizer subscription using an already delegated Graph token. */
export async function provisionOrganizerTranscriptSubscription(input: {
  accessToken: string
  ownerEmail: string
  entraTenantId: string
  expectedOrganizerUserId?: string
}) {
  requireUuid(input.entraTenantId, "Entra tenant ID")
  const notificationUrl = transcriptNotificationUrl()

  const me = await callIntegrationApi<GraphMe>({
    provider: "microsoft_graph",
    operation: "read_connected_organizer",
    path: "/me",
    method: "GET",
    accessToken: input.accessToken,
    query: { "$select": "id,mail,userPrincipalName" },
  })
  requireUuid(me.id, "Connected organizer ID")
  if (input.expectedOrganizerUserId && me.id.toLowerCase() !== input.expectedOrganizerUserId.toLowerCase()) {
    throw new Error("Microsoft Graph organizer identity did not match the authorized account.")
  }

  const clientState = randomBytes(32).toString("base64url")
  const resource = `users/${me.id}/onlineMeetings/getAllTranscripts`
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000).toISOString()
  const graphSubscription = await callIntegrationApi<GraphSubscription>({
    provider: "microsoft_graph",
    operation: "create_organizer_transcript_subscription",
    path: "/subscriptions",
    method: "POST",
    accessToken: input.accessToken,
    body: {
      changeType: "created",
      notificationUrl,
      resource,
      expirationDateTime,
      clientState,
    },
  })

  if (!graphSubscription.id || !graphSubscription.expirationDateTime || graphSubscription.resource !== resource) {
    throw new Error("Microsoft Graph returned an incomplete transcript subscription.")
  }

  try {
    await saveTeamsTranscriptSubscription({
      subscriptionId: graphSubscription.id,
      ownerEmail: input.ownerEmail,
      entraTenantId: input.entraTenantId,
      organizerUserId: me.id,
      clientState,
      resource,
      expiresAt: graphSubscription.expirationDateTime,
    })
  } catch (error) {
    try {
      await callIntegrationApi<void>({
        provider: "microsoft_graph",
        operation: "rollback_unstored_transcript_subscription",
        path: `/subscriptions/${graphSubscription.id}`,
        method: "DELETE",
        accessToken: input.accessToken,
      })
    } catch {
      console.error("[teams-transcripts] Could not roll back an unrecorded Graph subscription.")
    }
    throw error
  }

  return {
    subscriptionId: graphSubscription.id,
    organizerUserId: me.id,
    expiresAt: graphSubscription.expirationDateTime,
  }
}

/** Extends soon-to-expire delegated subscriptions before Graph stops notifications. */
export async function renewDueTeamsTranscriptSubscriptions() {
  const due = await listTeamsTranscriptSubscriptionsForRenewal(50)
  let renewed = 0
  let failed = 0
  for (const subscription of due) {
    try {
      const accessToken = await getTeamsTranscriptAccessToken(
        subscription.owner_email,
        subscription.entra_tenant_id,
        subscription.organizer_user_id,
        false,
        true,
      )
      const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000).toISOString()
      try {
        await callIntegrationApi<void>({
          provider: "microsoft_graph",
          operation: "renew_organizer_transcript_subscription",
          path: `/subscriptions/${subscription.subscription_id}`,
          method: "PATCH",
          accessToken,
          body: { expirationDateTime },
        })
        await updateTeamsTranscriptSubscriptionExpiry(subscription.subscription_id, expirationDateTime)
      } catch {
        // If Graph already expired or removed the subscription, establish a fresh one.
        await provisionOrganizerTranscriptSubscription({
          accessToken,
          ownerEmail: subscription.owner_email,
          entraTenantId: subscription.entra_tenant_id,
          expectedOrganizerUserId: subscription.organizer_user_id,
        })
      }
      renewed += 1
    } catch {
      failed += 1
    }
  }
  return { found: due.length, renewed, failed }
}
