import { describe, expect, it } from "vitest"
import { hashTeamsClientState, matchesTeamsClientState, parseTeamsTranscriptNotifications, parseTeamsTranscriptResource, teamsResourceMatchesOrganizer } from "@/lib/teams-transcript-notifications"

const organizerId = "c16a6df9-4f18-4f5e-9c79-12c5c0e68031"

describe("Teams transcript notification boundary", () => {
  it("accepts bounded transcript-created Graph notifications", () => {
    expect(parseTeamsTranscriptNotifications({ value: [{
      subscriptionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      clientState: "0123456789abcdef0123456789abcdef",
      changeType: "created",
      resource: `users/${organizerId}/onlineMeetings('meeting')/transcripts('transcript')`,
      tenantId: "914a6908-7be5-4b27-9654-3f028ec376f2",
      resourceData: { id: "transcript" },
    }] })).toHaveLength(1)
  })

  it("rejects malformed payloads and non-created notifications", () => {
    expect(() => parseTeamsTranscriptNotifications({ value: [] })).toThrow()
    expect(() => parseTeamsTranscriptNotifications({ value: [{ subscriptionId: "bad" }] })).toThrow()
    expect(() => parseTeamsTranscriptNotifications({ value: [{
      subscriptionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      clientState: "0123456789abcdef0123456789abcdef",
      changeType: "updated",
      resource: "users/x/onlineMeetings/x/transcripts/x",
    }] })).toThrow()
  })

  it("uses hashed client state and constant-time comparison", () => {
    const hash = hashTeamsClientState("0123456789abcdef0123456789abcdef")
    expect(hash).not.toContain("0123456789abcdef")
    expect(matchesTeamsClientState("0123456789abcdef0123456789abcdef", hash)).toBe(true)
    expect(matchesTeamsClientState("fedcba9876543210fedcba9876543210", hash)).toBe(false)
  })

  it("limits user-scoped transcript notifications to the subscribed organizer", () => {
    const subscription = `users/${organizerId}/onlineMeetings/getAllTranscripts`
    expect(teamsResourceMatchesOrganizer(subscription, `users/${organizerId}/onlineMeetings('meeting')/transcripts('transcript')`)).toBe(true)
    expect(teamsResourceMatchesOrganizer(subscription, "users/226a6df9-4f18-4f5e-9c79-12c5c0e68031/onlineMeetings('meeting')/transcripts('transcript')")).toBe(false)
    expect(teamsResourceMatchesOrganizer("communications/onlineMeetings/getAllTranscripts", `users/${organizerId}/onlineMeetings('meeting')/transcripts('transcript')`)).toBe(false)
  })

  it("extracts meeting and transcript identifiers only from the expected Graph resource shape", () => {
    expect(parseTeamsTranscriptResource(`users/${organizerId}/onlineMeetings('meeting-id')/transcripts('transcript-id')`)).toEqual({
      organizerUserId: organizerId,
      meetingId: "meeting-id",
      transcriptId: "transcript-id",
    })
    expect(parseTeamsTranscriptResource(`users/${organizerId}/onlineMeetings('meeting')/transcripts('transcript')/content`)).toBeNull()
    expect(parseTeamsTranscriptResource("https://evil.example/transcripts/id")).toBeNull()
  })
})
