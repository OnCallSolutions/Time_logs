import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function encryptionKey() {
  const value = process.env.TEAMS_TOKEN_ENCRYPTION_KEY
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("TEAMS_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key.")
  }
  return Buffer.from(value, "hex")
}

/** Encrypts the MSAL cache with an authenticated envelope before database persistence. */
export function encryptTeamsTokenCache(plainText: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`
}

/** Decrypts only the versioned cache envelope written by this application. */
export function decryptTeamsTokenCache(envelope: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".")
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new Error("Invalid Teams token-cache envelope.")
  }
  const iv = Buffer.from(ivValue, "base64url")
  const tag = Buffer.from(tagValue, "base64url")
  const ciphertext = Buffer.from(ciphertextValue, "base64url")
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid Teams token-cache envelope.")
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
