import { withOperationalCapture } from "@/lib/api-outcome-capture"
import { enqueueTeamsTranscriptNotification } from "@/lib/teams-transcript-inbox"
import { parseTeamsTranscriptNotifications } from "@/lib/teams-transcript-notifications"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_NOTIFICATION_BODY_BYTES = 128_000

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_NOTIFICATION_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function receiveTranscriptNotifications(request: Request) {
  const validationToken = new URL(request.url).searchParams.get("validationToken")
  if (validationToken !== null) {
    if (validationToken.length > 4096 || /[\r\n]/.test(validationToken)) {
      return new Response("Invalid validation token.", { status: 400 })
    }
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  }

  try {
    const contentLengthHeader = request.headers.get("content-length")
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0
    if (Number.isFinite(contentLength) && contentLength > MAX_NOTIFICATION_BODY_BYTES) {
      return Response.json({ error: "Notification batch is too large." }, { status: 413 })
    }
    const body = await readBoundedBody(request)
    if (body === null) return Response.json({ error: "Notification batch is too large." }, { status: 413 })
    const notifications = parseTeamsTranscriptNotifications(JSON.parse(body))
    let accepted = 0
    for (const notification of notifications) {
      const stored = await enqueueTeamsTranscriptNotification({
        subscriptionId: notification.subscriptionId,
        clientState: notification.clientState,
        resource: notification.resource,
        providerTranscriptId: notification.resourceData?.id ?? null,
        tenantId: notification.tenantId ?? null,
      })
      if (stored) accepted += 1
    }
    return Response.json({ accepted }, { status: 202, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid transcript notification batch." }, { status: 400 })
    }
    console.error("[teams-transcripts] notification intake failed")
    return Response.json({ error: "Transcript notifications could not be queued." }, { status: 503 })
  }
}

export const POST = withOperationalCapture("/api/teams/transcripts/notifications", "POST", receiveTranscriptNotifications)
