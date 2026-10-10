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
const fingerprint=z.string().regex(/^[a-f0-9]{64}$/)
export const encryptedMessageSchema=z.object({version:z.union([z.literal(1),z.literal(2)]),nonce:encoded.length(16),ciphertext:encoded.min(24).max(22000),sender:z.string().email(),recipient:z.string().email().nullable(),token:z.string().uuid(),author:z.string().email(),authorFingerprint:fingerprint.optional(),signature:encoded.max(128),keys:z.record(z.string().email(),z.object({wrapped:encoded.max(1024),fingerprint,devices:z.record(fingerprint,encoded.max(1024)).optional()}).strict())}).strict().superRefine((payload,context)=>{
  if(Object.keys(payload.keys).length>100)context.addIssue({code:"custom",message:"Too many participants."})
  if(payload.version===2&&(!payload.authorFingerprint||Object.values(payload.keys).some(key=>!key.devices||Object.keys(key.devices).length<1||Object.keys(key.devices).length>6||key.devices[key.fingerprint]!==key.wrapped)))context.addIssue({code:"custom",message:"Invalid device envelopes."})
  if(payload.version===1&&(payload.authorFingerprint||Object.values(payload.keys).some(key=>key.devices)))context.addIssue({code:"custom",message:"Invalid legacy envelope."})
})
/** @param payload - Parsed encrypted envelope. @param author - Authenticated actor. @param sender - Original sender. @param recipient - Validated recipient. @param participants - Exact authorized identities. @returns Promise<boolean> indicating valid public identities and signature. */
export async function validateEnvelope(payload:z.infer<typeof encryptedMessageSchema>,author:string,sender:string,recipient:string|null,participants:string[]):Promise<boolean>{
  const emails=[...new Set(participants.map(email=>email.toLowerCase()))].sort()
  if(!emails.includes(author.toLowerCase()))return false
  if(payload.author!==author.toLowerCase()||payload.sender!==sender.toLowerCase()||payload.recipient!==(recipient?.toLowerCase()??null)||JSON.stringify(Object.keys(payload.keys).sort())!==JSON.stringify(emails)||emails.length>100)return false
  const keys=await publicMessageKeys(emails)
  if(emails.some(email=>!keys.some(key=>key.email===email)))return false
  if(payload.version===1){if(emails.some(email=>!keys.some(key=>key.email===email&&key.fingerprint===payload.keys[email].fingerprint)))return false}
  else if(emails.some(email=>{
    const enrolled=[...new Set(keys.filter(key=>key.email===email).map(key=>key.fingerprint))].sort()
    return JSON.stringify(Object.keys(payload.keys[email].devices??{}).sort())!==JSON.stringify(enrolled)
  }))return false
  const identity=keys.find(key=>key.email===author.toLowerCase()&&key.fingerprint===(payload.version===2?payload.authorFingerprint:payload.keys[author.toLowerCase()].fingerprint));if(!identity)return false
  const values:unknown[]=[payload.version,payload.nonce,payload.ciphertext,payload.sender,payload.recipient,payload.token,payload.author]
  if(payload.version===2)values.push(payload.authorFingerprint,Object.keys(payload.keys).sort().map(email=>[email,payload.keys[email].fingerprint,payload.keys[email].wrapped,Object.entries(payload.keys[email].devices??{}).sort(([a],[b])=>a<b?-1:a>b?1:0)]))
  return verify("sha256",Buffer.from(JSON.stringify(values)),{key:createPublicKey({key:Buffer.from(identity.signingKey,"base64"),format:"der",type:"spki"}),dsaEncoding:"ieee-p1363"},Buffer.from(payload.signature,"base64"))
}
