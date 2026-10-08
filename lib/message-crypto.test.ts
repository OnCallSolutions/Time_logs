// @vitest-environment node
/**
 * Verifies real recovery, recipient isolation, deadlines, and message signatures.
 * Uses ephemeral identities and Web Crypto rather than mocked encryption output.
 * No account secrets or production database connections are involved.
 */
import { beforeAll,expect,it,vi } from "vitest"
import { webcrypto } from "node:crypto"
vi.mock("@/lib/message-keys",()=>({publicMessageKeys:vi.fn()}))
import { publicMessageKeys } from "./message-keys"
import { validateEnvelope } from "./message-envelope"
import { createMessageIdentity,recoverMessageIdentity,encryptMessage,decryptMessage,type PublicMessageKey } from "./message-crypto"
import { canEditMessage,MESSAGE_EDIT_MINUTES } from "./message-policy"
let sender:Awaited<ReturnType<typeof createMessageIdentity>>
let recipient:Awaited<ReturnType<typeof createMessageIdentity>>
let keys:PublicMessageKey[]
beforeAll(async()=>{
  vi.stubGlobal("crypto",webcrypto)
  sender=await createMessageIdentity("A long sender recovery passphrase","manager@example.com")
  recipient=await createMessageIdentity("A long recipient recovery passphrase","employee@example.com")
  keys=[{email:"manager@example.com",...sender.identity},{email:"employee@example.com",...recipient.identity}]
},30000)
it("recovers on another device and decrypts only for authorized participants",async()=>{
  const payload=await encryptMessage("Private content",sender.identity,keys[0].email,keys[0].email,keys[1].email,keys)
  const recovered=await recoverMessageIdentity(recipient.backup,"A long recipient recovery passphrase",keys[1])
  expect(await decryptMessage(payload,recovered,keys[1].email,keys[0])).toBe("Private content")
  expect(await decryptMessage(payload,sender.identity,keys[0].email,keys[0])).toBe("Private content")
  await expect(decryptMessage(payload,sender.identity,"outsider@example.com",keys[0])).rejects.toThrow()
  expect(JSON.stringify(payload)).not.toContain("Private content")
  expect(JSON.stringify(sender.backup)).not.toContain("sender recovery")
  expect(recovered.encryption.extractable).toBe(false)
})
it("rejects incorrect recovery secrets and modified ciphertext",async()=>{
  await expect(recoverMessageIdentity(recipient.backup,"Wrong recovery passphrase",keys[1])).rejects.toThrow()
  const payload=await encryptMessage("Private content",sender.identity,keys[0].email,keys[0].email,keys[1].email,keys)
  await expect(decryptMessage({...payload,ciphertext:payload.ciphertext.replace(/^./,payload.ciphertext[0]==="A"?"B":"A")},recipient.identity,keys[1].email,keys[0])).rejects.toThrow("signature")
})
it("verifies browser signatures on the server and rejects participant substitution",async()=>{
  vi.mocked(publicMessageKeys).mockResolvedValue(keys)
  const payload=await encryptMessage("Private content",sender.identity,keys[0].email,keys[0].email,keys[1].email,keys)
  expect(await validateEnvelope(payload,keys[0].email,keys[0].email,keys[1].email,keys.map(key=>key.email))).toBe(true)
  expect(await validateEnvelope(payload,keys[1].email,keys[0].email,keys[1].email,keys.map(key=>key.email))).toBe(false)
  expect(await validateEnvelope(payload,keys[0].email,keys[0].email,keys[1].email,[keys[0].email])).toBe(false)
})
it("closes sender editing at one hour while keeping admin exemption",()=>{
  const message={id:"one",sender_email:keys[0].email,recipient_email:null,body:"text",created_at:"2026-10-08T12:00:00Z"}
  const deadline=Date.parse(message.created_at)+MESSAGE_EDIT_MINUTES*60000
  expect(MESSAGE_EDIT_MINUTES).toBe(60)
  expect(canEditMessage(message,keys[0].email,false,deadline-1)).toBe(true)
  expect(canEditMessage(message,keys[0].email,false,deadline)).toBe(false)
  expect(canEditMessage(message,keys[0].email,true,deadline+1)).toBe(true)
  expect(canEditMessage({...message,deleted_at:"now"},keys[0].email,true)).toBe(false)
})
