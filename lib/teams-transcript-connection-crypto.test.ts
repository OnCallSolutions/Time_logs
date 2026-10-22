import { beforeEach, describe, expect, it } from "vitest"
import { decryptTeamsTokenCache, encryptTeamsTokenCache } from "./teams-transcript-connection-crypto"

describe("Teams connection secret protection", () => {
  beforeEach(() => {
    process.env.TEAMS_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("encrypts and decrypts the MSAL cache with an authenticated envelope", () => {
    const cache = JSON.stringify({ RefreshToken: "sensitive-refresh-token" })
    const encrypted = encryptTeamsTokenCache(cache)
    expect(encrypted).not.toContain("sensitive-refresh-token")
    expect(decryptTeamsTokenCache(encrypted)).toBe(cache)
  })

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptTeamsTokenCache("cache")
    const parts = encrypted.split(".")
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`
    expect(() => decryptTeamsTokenCache(parts.join("."))).toThrow()
  })

  it("requires a strong configured encryption key", () => {
    delete process.env.TEAMS_TOKEN_ENCRYPTION_KEY
    expect(() => encryptTeamsTokenCache("cache")).toThrow("32-byte hex key")
  })
})
