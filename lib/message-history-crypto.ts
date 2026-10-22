/**
 * Transfers message content keys between registered devices of the same account.
 * Original ciphertext/signatures remain unchanged and plaintext never reaches APIs.
 * Signed shares are bound to one message revision and one target device fingerprint.
 */
import { decryptMessage, type EncryptedMessage, type MessageIdentity, type PublicMessageKey } from "./message-crypto"
export type HistoryShare = { messageId: string; sourceSignature: string; targetFingerprint: string; authorFingerprint: string; wrapped: string; signature: string }
/** @param bytes - Binary ciphertext or signature. @returns Base64 transport representation. */
const encode = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes)))
/** @param value - Base64 ciphertext or signature. @returns Owned binary transport buffer. */
const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), char => char.charCodeAt(0))
/**
 * Canonicalizes a scoped device-share signature without exposing content keys.
 * @param owner - Authenticated account owning both participating devices.
 * @param share - Transfer metadata excluding its signature.
 * @returns Uint8Array<ArrayBuffer> containing deterministic signing bytes.
 */
export function historyShareBytes(owner: string, share: Omit<HistoryShare, "signature">): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(JSON.stringify([owner.toLowerCase(), share.messageId, share.sourceSignature, share.targetFingerprint, share.authorFingerprint, share.wrapped])))
}
/**
 * Verifies original evidence before wrapping its AES key for another own device.
 * @param messageId - Persistent message UUID.
 * @param payload - Unchanged signed ciphertext from an authorized history page.
 * @param identity - Existing local nonextractable identity.
 * @param owner - Account email identifying its own content-key envelope.
 * @param author - Original author's published verification identity.
 * @param target - Registered destination device belonging to the same owner.
 * @param prior - Previously signed own-device transfer and its verification identity, if recovered.
 * @returns Promise<HistoryShare> with only a wrapped key and authenticated context.
 */
export async function createHistoryShare(messageId: string, payload: EncryptedMessage, identity: MessageIdentity, owner: string, author: PublicMessageKey, target: PublicMessageKey, prior?:{share:HistoryShare;device:PublicMessageKey}): Promise<HistoryShare> {
  if (target.email.toLowerCase() !== owner.toLowerCase()) throw new Error("History can only sync to this account's devices.")
  if(prior)await decryptHistoryMessage(payload,identity,owner,author,prior.share,prior.device)
  else await decryptMessage(payload, identity, owner, author)
  const envelope = payload.keys[owner.toLowerCase()]
  const wrapped = prior?.share.wrapped??(payload.version === 2 ? envelope?.devices?.[identity.fingerprint] : envelope?.fingerprint === identity.fingerprint ? envelope.wrapped : undefined)
  if (!wrapped) throw new Error("Source device has no message key.")
  const key = await crypto.subtle.unwrapKey("raw", decode(wrapped), identity.encryption, "RSA-OAEP", { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
  const publicKey = await crypto.subtle.importKey("spki", decode(target.publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"])
  const share = { messageId, sourceSignature: payload.signature, targetFingerprint: target.fingerprint, authorFingerprint: identity.fingerprint, wrapped: encode(await crypto.subtle.wrapKey("raw", key, publicKey, "RSA-OAEP")) }
  return { ...share, signature: encode(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.signing, historyShareBytes(owner, share))) }
}
/**
 * Validates an own-device transfer and decrypts the still-authenticated original.
 * @param payload - Original message envelope, not a replacement authored by the relay.
 * @param identity - Current target's local private key.
 * @param owner - Current authenticated account email.
 * @param author - Original message author's verification key.
 * @param share - Own-device or organization-recovery signed key transfer.
 * @param device - Published verification identity of the share author.
 * @returns Promise<string> with original authenticated plaintext, or a rejection.
 */
export async function decryptHistoryMessage(payload: EncryptedMessage, identity: MessageIdentity, owner: string, author: PublicMessageKey, share: HistoryShare, device: PublicMessageKey): Promise<string> {
  if (device.email.toLowerCase() !== owner.toLowerCase() || share.sourceSignature !== payload.signature || share.targetFingerprint !== identity.fingerprint || share.authorFingerprint !== device.fingerprint) throw new Error("History transfer identity mismatch.")
  const key = await crypto.subtle.importKey("spki", decode(device.signingKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decode(share.signature), historyShareBytes(owner, share))) throw new Error("History transfer signature mismatch.")
  return decryptMessage(payload, identity, owner, author, share.wrapped)
}
