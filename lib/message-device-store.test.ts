// @vitest-environment node
/**
 * Verifies IndexedDB persistence using the standard fake-indexeddb adapter.
 * Real Web Crypto keys remain nonextractable and usable after structured cloning.
 * Account isolation and explicit forgetting are checked without live identities.
 */
import { IDBFactory } from "fake-indexeddb"
import { webcrypto } from "node:crypto"
import { beforeEach,afterEach,expect,it,vi } from "vitest"
import { rememberDeviceIdentity,loadDeviceIdentity,forgetDeviceIdentity } from "./message-device-store"
import type { MessageIdentity } from "./message-crypto"
beforeEach(()=>{vi.stubGlobal("indexedDB",new IDBFactory());vi.stubGlobal("crypto",webcrypto)})
afterEach(()=>vi.unstubAllGlobals())
it("retains nonextractable keys usable only under the stored account",async()=>{
  const encryption=await webcrypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},false,["encrypt","decrypt"])
  const signing=await webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"])
  const identity={encryption:encryption.privateKey,signing:signing.privateKey,publicKey:"public",signingKey:"signing",fingerprint:"fingerprint"} as MessageIdentity
  await rememberDeviceIdentity("Own@Example.com",identity)
  const remembered=await loadDeviceIdentity("own@example.com")
  expect(remembered?.encryption.extractable).toBe(false)
  expect(remembered?.signing.extractable).toBe(false)
  await expect(webcrypto.subtle.exportKey("pkcs8",remembered!.encryption as never)).rejects.toThrow()
  const plain=new TextEncoder().encode("probe")
  const encrypted=await webcrypto.subtle.encrypt("RSA-OAEP",encryption.publicKey,plain)
  expect(new TextDecoder().decode(await webcrypto.subtle.decrypt("RSA-OAEP",remembered!.encryption as never,encrypted))).toBe("probe")
  expect(await loadDeviceIdentity("other@example.com")).toBeNull()
  await forgetDeviceIdentity("own@example.com");expect(await loadDeviceIdentity("own@example.com")).toBeNull()
})
it("rejects extractable private keys before opening storage",async()=>{
  await expect(rememberDeviceIdentity("own@example.com",{encryption:{extractable:true},signing:{extractable:false}} as never)).rejects.toThrow("Extractable")
})
