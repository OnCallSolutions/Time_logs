import { describe, expect, it } from "vitest"
import { extractTeamsVttSpeakerLabels, resolveTeamsSpeakerAttributions } from "@/lib/teams-transcript-attribution"

const patrons = [
  { email: "baraza@example.test", officialName: "Baraza Otieno" },
  { email: "maurice@example.test", officialName: "Maurice Baraza" },
]

describe("Teams transcript speaker identity", () => {
  it("extracts distinct speaker labels from attributed VTT", () => {
    expect(extractTeamsVttSpeakerLabels("WEBVTT\n<v Baraza Otieno>Hello</v>\n<v Baraza Otieno>Again</v>\n<v Maurice &amp; Team>Hi</v>"))
      .toEqual(["Baraza Otieno", "Maurice & Team"])
  })

  it("resolves a label only when one attendee email maps to a known patron", () => {
    expect(resolveTeamsSpeakerAttributions(["Baraza Otieno"], [
      { emailAddress: "BARAZA@example.test", identity: { displayName: "Baraza Otieno" } },
      { emailAddress: "guest@example.test", identity: { displayName: "External Guest" } },
    ], patrons)).toEqual([{ speakerName: "Baraza Otieno", patronEmail: "baraza@example.test", attribution: "resolved" }])
  })

  it("leaves duplicate names ambiguous even if only one attendee is a patron", () => {
    expect(resolveTeamsSpeakerAttributions(["Baraza Otieno"], [
      { emailAddress: "baraza@example.test", identity: { displayName: "Baraza Otieno" } },
      { emailAddress: "external@example.net", identity: { displayName: "Baraza Otieno" } },
    ], patrons)[0]).toMatchObject({ patronEmail: null, attribution: "ambiguous" })
  })

  it("leaves unknown attendees and unattributed speech without a patron identity", () => {
    expect(resolveTeamsSpeakerAttributions(["Outside Person", null], [
      { emailAddress: "outsider@example.test", identity: { displayName: "Outside Person" } },
    ], patrons)).toEqual([
      { speakerName: "Outside Person", patronEmail: null, attribution: "unmatched" },
      { speakerName: "", patronEmail: null, attribution: "unattributed" },
    ])
  })
})
