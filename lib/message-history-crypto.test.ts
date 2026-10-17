// @vitest-environment node
/**
 * Verifies real cross-device key transfers and the opt-in organization fallback.
 * Ephemeral Web Crypto/Node keys prove confidentiality and signature binding.
 * No production recovery key, message, account or database is used.
 */
import { beforeAll, afterEach, expect, it, vi } from "vitest"
import { webcrypto, generateKeyPairSync } from "node:crypto"
import { createDeviceIdentity, encryptMessage, decryptMessage, type MessageIdentity, type PublicMessageKey } from "./message-crypto"
import { createHistoryShare, decryptHistoryMessage } from "./message-history-crypto"
import { organizationRecoveryKeys, recoverHistoryKey } from "./message-organization-recovery"
let first:MessageIdentity,second:MessageIdentity,author:PublicMessageKey,target:PublicMessageKey
const owner="contractor@example.com",messageId="123e4567-e89b-42d3-a456-426614174000"
beforeAll(async()=>{
  vi.stubGlobal("crypto",webcrypto)
  first=await createDeviceIdentity();second=await createDeviceIdentity()
  author={email:owner,...first};target={email:owner,...second}
},30000)
afterEach(()=>vi.unstubAllEnvs())
it("syncs old ciphertext to a new device without exporting either private identity",async()=>{
  const payload=await encryptMessage("Original private history",first,owner,owner,owner,[author],true)
  await expect(decryptMessage(payload,second,owner,author)).rejects.toThrow()
  const share=await createHistoryShare(messageId,payload,first,owner,author,target)
  expect(await decryptHistoryMessage(payload,second,owner,author,share,author)).toBe("Original private history")
  expect(JSON.stringify(share)).not.toContain("Original private history")
  expect(first.encryption.extractable).toBe(false)
})
it("rejects altered shares, different revisions and cross-account transfers",async()=>{
  const payload=await encryptMessage("Private",first,owner,owner,owner,[author],true)
  const share=await createHistoryShare(messageId,payload,first,owner,author,target)
  await expect(createHistoryShare(messageId,payload,first,owner,author,{...target,email:"other@example.com"})).rejects.toThrow()
  await expect(decryptHistoryMessage(payload,second,owner,author,{...share,messageId:crypto.randomUUID()},author)).rejects.toThrow("signature")
  await expect(decryptHistoryMessage({...payload,signature:"different"},second,owner,author,share,author)).rejects.toThrow("mismatch")
})
it("requires configured organization keys and rewraps only enrolled recovery evidence",async()=>{
  vi.stubEnv("MESSAGE_RECOVERY_ENCRYPTION_KEY","");vi.stubEnv("MESSAGE_RECOVERY_SIGNING_KEY","")
  expect(organizationRecoveryKeys([owner])).toEqual([])
  const rsa=generateKeyPairSync("rsa",{modulusLength:3072}),ec=generateKeyPairSync("ec",{namedCurve:"prime256v1"})
  vi.stubEnv("MESSAGE_RECOVERY_ENCRYPTION_KEY",rsa.privateKey.export({type:"pkcs8",format:"pem"}).toString())
  vi.stubEnv("MESSAGE_RECOVERY_SIGNING_KEY",ec.privateKey.export({type:"pkcs8",format:"pem"}).toString())
  const recovery=organizationRecoveryKeys([owner])[0]
  const payload=await encryptMessage("Recoverable history",first,owner,owner,owner,[author,recovery],true)
  const share=recoverHistoryKey(owner,messageId,payload.signature,payload.keys[owner].devices![recovery.fingerprint],target)
  expect(await decryptHistoryMessage(payload,second,owner,author,share,recovery)).toBe("Recoverable history")
  expect(JSON.stringify(organizationRecoveryKeys([owner]))).not.toContain("PRIVATE KEY")
},30000)
