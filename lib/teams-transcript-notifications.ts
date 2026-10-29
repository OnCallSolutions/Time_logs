import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const notificationSchema = z.object({
  subscriptionId: z.string().uuid(),
  clientState: z.string().min(16).max(256),
  changeType: z.literal("created"),
  resource: z.string().min(1).max(2048),
  tenantId: z.string().uuid().optional(),
  resourceData: z.object({ id: z.string().min(1).max(512).optional() }).passthrough().optional(),
}).passthrough()

const batchSchema = z.object({ value: z.array(notificationSchema).min(1).max(100) }).passthrough()

export type TeamsTranscriptNotification = z.infer<typeof notificationSchema>

export function parseTeamsTranscriptNotifications(value: unknown): TeamsTranscriptNotification[] {
  return batchSchema.parse(value).value
}

export function hashTeamsClientState(clientState: string): string {
  return createHash("sha256").update(clientState, "utf8").digest("hex")
}

export function matchesTeamsClientState(clientState: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashTeamsClientState(clientState), "hex")
  const expected = /^[a-f0-9]{64}$/i.test(expectedHash) ? Buffer.from(expectedHash, "hex") : Buffer.alloc(0)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function teamsResourceMatchesOrganizer(subscriptionResource: string, notificationResource: string): boolean {
  const subscription = /^users\/([0-9a-f-]{36})\/onlineMeetings\/getAllTranscripts$/i.exec(subscriptionResource)
  const notification = /^users\/([0-9a-f-]{36})\/onlineMeetings\('[^']+'\)\/transcripts\('[^']+'\)$/i.exec(notificationResource)
  return !!subscription && !!notification && subscription[1].toLowerCase() === notification[1].toLowerCase()
}

export function parseTeamsTranscriptResource(resource: string) {
  const match = /^users\/([0-9a-f-]{36})\/onlineMeetings\('([^']{1,512})'\)\/transcripts\('([^']{1,512})'\)$/i.exec(resource)
  if (!match) return null
  return { organizerUserId: match[1], meetingId: match[2], transcriptId: match[3] }
}
