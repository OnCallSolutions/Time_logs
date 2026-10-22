/**
 * Provides opt-in organization-held recovery keys for administrator-assisted history.
 * Private material is read only on the server and never returned to browsers.
 * Enabling this makes the organization a trusted recovery endpoint, not blind E2EE.
 */
import "server-only"
import { createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, sign, constants } from "node:crypto"
import type { PublicMessageKey } from "./message-crypto"
import { historyShareBytes, type HistoryShare } from "./message-history-crypto"

/**
 * Loads a valid recovery key pair or leaves recovery disabled without generating secrets.
 * @returns Server-only key objects and public metadata, or null when unconfigured.
 */
function recoveryKeys() {
  const encryption = process.env.MESSAGE_RECOVERY_ENCRYPTION_KEY, signing = process.env.MESSAGE_RECOVERY_SIGNING_KEY
  if (!encryption && !signing) return null
  if (!encryption || !signing) throw new Error("Organization recovery configuration is incomplete.")
  const privateEncryption = createPrivateKey(encryption.replace(/\\n/g, "\n")), privateSigning = createPrivateKey(signing.replace(/\\n/g, "\n"))
  if (privateEncryption.asymmetricKeyType !== "rsa" || privateEncryption.asymmetricKeyDetails?.modulusLength !== 3072 || privateSigning.asymmetricKeyType !== "ec" || privateSigning.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Organization recovery key configuration is invalid.")
  const publicKey = createPublicKey(privateEncryption).export({ format: "der", type: "spki" }).toString("base64")
  const signingKey = createPublicKey(privateSigning).export({ format: "der", type: "spki" }).toString("base64")
  return { privateEncryption, privateSigning, publicKey, signingKey, fingerprint: createHash("sha256").update(`${publicKey}:${signingKey}`).digest("hex") }
}
/**
 * Publishes the recovery endpoint as a device for each authorized account.
 * @param emails - Server-scoped participant identities, never an unfiltered directory.
 * @returns PublicMessageKey[]; no private material or backup secrets are exposed.
 */
export function organizationRecoveryKeys(emails: string[]): PublicMessageKey[] {
  const keys = recoveryKeys()
  return keys ? [...new Set(emails.map(email => email.toLowerCase()))].map(email => ({ email, publicKey: keys.publicKey, signingKey: keys.signingKey, fingerprint: keys.fingerprint, deviceId: "organization-recovery" })) : []
}
/**
 * Rewraps an existing recovery envelope to a registered account device without plaintext.
 * @param owner - Account whose original history is being restored.
 * @param messageId - Exact historical message UUID.
 * @param sourceSignature - Original message revision signature.
 * @param wrapped - Existing AES key wrapped to the organization recovery endpoint.
 * @param target - Registered destination device with the same account email.
 * @returns HistoryShare signed by the configured organization recovery identity.
 */
export function recoverHistoryKey(owner: string, messageId: string, sourceSignature: string, wrapped: string, target: PublicMessageKey): HistoryShare {
  const keys = recoveryKeys()
  if (!keys || target.email.toLowerCase() !== owner.toLowerCase()) throw new Error("Recovery unavailable.")
  const raw = privateDecrypt({ key: keys.privateEncryption, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(wrapped, "base64"))
  try {
    if (raw.length !== 32) throw new Error("Invalid recovery content key.")
    const next = publicEncrypt({ key: createPublicKey({ key: Buffer.from(target.publicKey, "base64"), format: "der", type: "spki" }), oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, raw).toString("base64")
    const share = { messageId, sourceSignature, targetFingerprint: target.fingerprint, authorFingerprint: keys.fingerprint, wrapped: next }
    return { ...share, signature: sign("sha256", Buffer.from(historyShareBytes(owner, share)), { key: keys.privateSigning, dsaEncoding: "ieee-p1363" }).toString("base64") }
  } finally { raw.fill(0) }
}
