/**
 * Validates encrypted message structure, participants, and author signatures.
 * This module handles public keys and ciphertext only, never plaintext or secrets.
 * Participant sets stay fixed during edits to avoid silently expanding access.
 */
import "server-only"
import { z } from "zod"
import { createPublicKey,verify } from "node:crypto"
import { publicMessageKeys } from "@/lib/message-keys"
const encoded=z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
export const encryptedMessageSchema=z.object({version:z.literal(1),nonce:encoded.length(16),ciphertext:encoded.min(24).max(22000),sender:z.string().email(),recipient:z.string().email().nullable(),token:z.string().uuid(),author:z.string().email(),signature:encoded.max(128),keys:z.record(z.string().email(),z.object({wrapped:encoded.max(1024),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}))}).strict()
/** @param payload - Parsed encrypted envelope. @param author - Authenticated actor. @param sender - Original sender. @param recipient - Validated recipient. @param participants - Exact authorized identities. @returns Promise<boolean> indicating valid public identities and signature. */
export async function validateEnvelope(payload:z.infer<typeof encryptedMessageSchema>,author:string,sender:string,recipient:string|null,participants:string[]):Promise<boolean>{
  const emails=[...new Set(participants.map(email=>email.toLowerCase()))].sort()
  if(payload.author!==author.toLowerCase()||payload.sender!==sender.toLowerCase()||payload.recipient!==(recipient?.toLowerCase()??null)||JSON.stringify(Object.keys(payload.keys).sort())!==JSON.stringify(emails)||emails.length>100)return false
  const keys=await publicMessageKeys(emails)
  if(keys.length!==emails.length||keys.some(key=>payload.keys[key.email]?.fingerprint!==key.fingerprint))return false
  const identity=keys.find(key=>key.email===author.toLowerCase());if(!identity)return false
  return verify("sha256",Buffer.from(JSON.stringify([payload.version,payload.nonce,payload.ciphertext,payload.sender,payload.recipient,payload.token,payload.author])),{key:createPublicKey({key:Buffer.from(identity.signingKey,"base64"),format:"der",type:"spki"}),dsaEncoding:"ieee-p1363"},Buffer.from(payload.signature,"base64"))
}
