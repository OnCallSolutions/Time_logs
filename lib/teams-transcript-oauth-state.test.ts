import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTeamsOAuthState, readTeamsOAuthState } from "./teams-transcript-oauth-state"

describe("Teams OAuth state", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-that-is-long-enough-for-hmac-signing"
    vi.useRealTimers()
  })

  it("signs a short-lived state bound to the current app session and patron", () => {
    const created = createTeamsOAuthState({
      appSessionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      ownerEmail: "patron@example.test",
    })
    expect(readTeamsOAuthState(created.value, created.state)).toMatchObject({
      appSessionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54",
      ownerEmail: "patron@example.test",
      verifier: created.verifier,
      nonce: created.nonce,
    })
  })

  it("rejects tampered and mismatched state", () => {
    const created = createTeamsOAuthState({ appSessionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54", ownerEmail: "patron@example.test" })
    expect(readTeamsOAuthState(created.value, "attacker-state")).toBeNull()
    expect(readTeamsOAuthState(`${created.value}x`, created.state)).toBeNull()
  })

  it("rejects expired OAuth attempts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-19T12:00:00.000Z"))
    const created = createTeamsOAuthState({ appSessionId: "5ed78c8c-7a4d-4bdb-9bcf-57aa91cc7a54", ownerEmail: "patron@example.test" })
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(readTeamsOAuthState(created.value, created.state)).toBeNull()
  })
})
