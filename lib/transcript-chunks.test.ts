import { describe, expect, it } from "vitest"
import { splitTranscriptIntoChunks } from "./transcript-chunks"

describe("splitTranscriptIntoChunks", () => {
  it("keeps every character and prefers speaker-turn line boundaries", () => {
    const source = "Franco Abott\n0 minutes 12 seconds\nYo.\n\nHope Mutanu\n0 minutes 15 seconds\nI found it.\n"
    const chunks = splitTranscriptIntoChunks(source, 50)
    expect(chunks.join("")).toBe(source)
    expect(chunks).toContain("Franco Abott\n0 minutes 12 seconds\nYo.\n\n")
    expect(chunks.every(chunk => chunk.length <= 50)).toBe(true)
  })

  it("splits long individual lines at word boundaries without truncation", () => {
    const source = "speaker: " + "work details ".repeat(30)
    const chunks = splitTranscriptIntoChunks(source, 40)
    expect(chunks.join("")).toBe(source)
    expect(chunks.every(chunk => chunk.length <= 40)).toBe(true)
  })

  it("returns no chunks for empty input and rejects invalid chunk sizes", () => {
    expect(splitTranscriptIntoChunks("")).toEqual([])
    expect(() => splitTranscriptIntoChunks("notes", 0)).toThrow("positive integer")
  })
})
