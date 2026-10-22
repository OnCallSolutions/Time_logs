import { describe, expect, it } from "vitest"
import { isValidIsoDate } from "@/lib/iso-date"

describe("calendar date validation", () => {
  it("accepts real ISO calendar dates, including leap days", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true)
    expect(isValidIsoDate("2026-10-20")).toBe(true)
  })

  it("rejects impossible dates and non-ISO values", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false)
    expect(isValidIsoDate("2026-13-01")).toBe(false)
    expect(isValidIsoDate("10/20/2026")).toBe(false)
  })
})
