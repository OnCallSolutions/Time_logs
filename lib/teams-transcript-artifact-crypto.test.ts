import { afterEach, describe, expect, it } from "vitest"
import { decryptTeamsTranscript, encryptTeamsTranscript } from "@/lib/teams-transcript-artifact-crypto"

const previousKey = process.env.TEAMS_TOKEN_ENCRYPTION_KEY

afterEach(() => {
  if (previousKey === undefined) delete process.env.TEAMS_TOKEN_ENCRYPTION_KEY
  else process.env.TEAMS_TOKEN_ENCRYPTION_KEY = previousKey
})

describe("encrypted Teams transcript artifacts", () => {
  it("round-trips source VTT without storing plaintext in the envelope", () => {
    process.env.TEAMS_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Contractor>Worked on project</v>"
    const encrypted = encryptTeamsTranscript(vtt)
    expect(encrypted).not.toContain("Contractor")
    expect(decryptTeamsTranscript(encrypted)).toBe(vtt)
  })

  it("rejects tampered envelopes and missing encryption configuration", () => {
    process.env.TEAMS_TOKEN_ENCRYPTION_KEY = "b".repeat(64)
    const encrypted = encryptTeamsTranscript("WEBVTT")
    const parts = encrypted.split(".")
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`
    expect(() => decryptTeamsTranscript(parts.join("."))).toThrow()
    delete process.env.TEAMS_TOKEN_ENCRYPTION_KEY
    expect(() => encryptTeamsTranscript("WEBVTT")).toThrow(/TEAMS_TOKEN_ENCRYPTION_KEY/)
  })
})
