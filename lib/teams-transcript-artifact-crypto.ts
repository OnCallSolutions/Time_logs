import "server-only"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

function transcriptKey() {
  const value = process.env.TEAMS_TOKEN_ENCRYPTION_KEY
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("TEAMS_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key.")
  return Buffer.from(hkdfSync("sha256", Buffer.from(value, "hex"), Buffer.from("tanovo-teams-transcripts"), Buffer.from("artifact-v1"), 32))
}

/** Encrypts source transcripts with a purpose-separated key derived from the key-encryption secret. */
export function encryptTeamsTranscript(content: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", transcriptKey(), iv)
  const encrypted = Buffer.concat([cipher.update(content, "utf8"), cipher.final()])
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`
}

/** Decrypts only the versioned transcript envelope written by this application. */
export function decryptTeamsTranscript(envelope: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".")
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) throw new Error("Invalid Teams transcript envelope.")
  if (![ivValue, tagValue, ciphertextValue].every(value => /^[A-Za-z0-9_-]+$/.test(value))) throw new Error("Invalid Teams transcript envelope.")
  const iv = Buffer.from(ivValue, "base64url")
  const tag = Buffer.from(tagValue, "base64url")
  const ciphertext = Buffer.from(ciphertextValue, "base64url")
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("Invalid Teams transcript envelope.")
  const decipher = createDecipheriv("aes-256-gcm", transcriptKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
