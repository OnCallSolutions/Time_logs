import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: vi.fn(schema => schema) } }))
import { generateText } from "ai"
import { attachTranscriptEvidence, extractTranscriptDraftEntries, transcriptTextForSpeaker, transcriptUtterancesForSpeaker } from "@/lib/teams-transcript-extraction"
import type { TeamsSpeakerAttribution } from "@/lib/teams-transcript-attribution"

beforeEach(() => vi.resetAllMocks())

const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Baraza Otieno>Worked on field service for two hours.</v>

00:00:05.000 --> 00:00:07.000
<v Maurice Baraza>Reviewed the operations plan.</v>

00:00:08.000 --> 00:00:10.000
<v Baraza Otieno>Tomorrow I will finish the report.</v>`

describe("Teams transcript speaker extraction", () => {
  it("keeps only utterances for a uniquely resolved patron speaker", () => {
    const speaker: TeamsSpeakerAttribution = { speakerName: "Baraza Otieno", patronEmail: "baraza@example.com", attribution: "resolved" }
    expect(transcriptTextForSpeaker(vtt, speaker)).toBe("Worked on field service for two hours.\nTomorrow I will finish the report.")
  })

  it("does not expose transcript text to extraction for unresolved speakers", () => {
    const speaker: TeamsSpeakerAttribution = { speakerName: "Baraza Otieno", patronEmail: null, attribution: "ambiguous" }
    expect(transcriptTextForSpeaker(vtt, speaker)).toBe("")
    expect(transcriptUtterancesForSpeaker(vtt, speaker)).toEqual([])
  })

  it("keeps cue timestamps and exact speaker evidence with stable per-speaker cue ids", () => {
    const speaker: TeamsSpeakerAttribution = { speakerName: "Baraza Otieno", patronEmail: "baraza@example.com", attribution: "resolved" }
    expect(transcriptUtterancesForSpeaker(vtt, speaker)).toEqual([
      { cueId: 1, start: "00:00:01.000", end: "00:00:04.000", text: "Worked on field service for two hours." },
      { cueId: 2, start: "00:00:08.000", end: "00:00:10.000", text: "Tomorrow I will finish the report." },
    ])
  })

  it("drops model proposals that do not cite a real cue", () => {
    const cue = { cueId: 1, start: "00:00:01.000", end: "00:00:04.000", text: "Worked on field service for two hours." }
    const base = { date: "2026-10-17", hours: 2, project: "Field service", description: "Site inspection", reviewFlags: [] }
    expect(attachTranscriptEvidence([
      { ...base, evidenceCueIds: [1, 999] },
      { ...base, evidenceCueIds: [999] },
    ], [cue])).toEqual([{ ...base, evidence: [cue], reviewFlags: ["evidence_unverified"] }])
  })

  it("flags unknown dates, unsupported hours, and hallucinated cue references", () => {
    const cue = { cueId: 1, start: "00:00:01.000", end: "00:00:04.000", text: "I worked on the field service dashboard." }
    const result = attachTranscriptEvidence([{
      date: null,
      hours: null,
      project: "Unassigned",
      description: "Updated the dashboard",
      evidenceCueIds: [1, 999],
      reviewFlags: [],
    }], [cue])
    expect(result).toEqual([expect.objectContaining({
      date: null,
      hours: null,
      evidence: [cue],
      reviewFlags: expect.arrayContaining(["date_needs_confirmation", "hours_needs_confirmation", "project_needs_confirmation", "evidence_unverified"]),
    })])
  })

  it("uses the configured high-intelligence Gateway route and meeting date for relative-date extraction", async () => {
    vi.mocked(generateText).mockResolvedValue({ output: { entries: [{
      date: "2026-10-18", hours: 2, project: "Field service", description: "Completed an inspection",
      evidenceCueIds: [1], reviewFlags: [],
    }] } } as never)
    const utterance = { cueId: 1, start: "00:00:01.000", end: "00:00:04.000", text: "Yesterday I completed the field service inspection for two hours." }
    const entries = await extractTranscriptDraftEntries([utterance], "2026-10-19", ["Field service"])
    const call = vi.mocked(generateText).mock.calls[0][0]
    expect(call.model).toBe("openai/gpt-6.1-sol")
    expect(call.providerOptions).toEqual({ gateway: { models: ["openai/gpt-5.6-sol"] } })
    expect(call.reasoning).toBe("high")
    expect(call.prompt).toContain("Meeting date (date reference for relative phrases): 2026-10-19")
    expect(entries[0].evidence).toEqual([utterance])
  })
})
