/**
 * Tests trusted-device restoration with mocked key storage and scoped directories.
 * Verifies key mismatch rejection, forgetting devices, and stable-directory reuse.
 * Real envelope confidentiality and signing remain covered by crypto unit tests.
 */
import { act,renderHook,waitFor } from "@testing-library/react"
import { beforeEach,afterEach,expect,it,vi } from "vitest"
vi.mock("@/lib/message-device-store",()=>({loadDeviceIdentity:vi.fn(),rememberDeviceIdentity:vi.fn(),forgetDeviceIdentity:vi.fn()}))
vi.mock("@/lib/message-crypto",()=>({identityFingerprint:vi.fn(async()=>"fingerprint"),decryptMessage:vi.fn(),encryptMessage:vi.fn(),recoverMessageIdentity:vi.fn(),createMessageIdentity:vi.fn()}))
import { loadDeviceIdentity,forgetDeviceIdentity } from "@/lib/message-device-store"
import { invalidateClientData } from "@/lib/client-data-cache"
import { useMessageEncryption } from "./use-message-encryption"
import type { MessageIdentity } from "@/lib/message-crypto"
import type { AppMessage } from "@/lib/message-policy"
const messages:AppMessage[]=[]
const identity={encryption:{extractable:false},signing:{extractable:false},publicKey:"public",signingKey:"signing",fingerprint:"fingerprint"} as unknown as MessageIdentity
beforeEach(()=>{
  vi.clearAllMocks();invalidateClientData();localStorage.clear()
  vi.mocked(loadDeviceIdentity).mockResolvedValue(identity)
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({own:{email:"own@example.com",publicKey:"public",signingKey:"signing",fingerprint:"fingerprint",backup:{}},keys:[]}))))
})
afterEach(()=>{vi.unstubAllGlobals();invalidateClientData()})
it("restores a matching trusted identity without asking for a passphrase",async()=>{
  const {result}=renderHook(()=>useMessageEncryption("own@example.com",messages))
  await waitFor(()=>expect(result.current.unlocked).toBe(true))
  expect(loadDeviceIdentity).toHaveBeenCalledWith("own@example.com")
})
it("fails closed when remembered public identity differs",async()=>{
  vi.mocked(loadDeviceIdentity).mockResolvedValue({...identity,fingerprint:"different"} as never)
  const {result}=renderHook(()=>useMessageEncryption("own@example.com",messages))
  await waitFor(()=>expect(result.current.error).toContain("identity changed"))
  expect(result.current.unlocked).toBe(false)
})
it("forgets local trust on explicit lock and avoids redundant directory reads",async()=>{
  const {result,rerender}=renderHook(()=>useMessageEncryption("own@example.com",messages))
  await waitFor(()=>expect(result.current.unlocked).toBe(true));rerender()
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(()=>result.current.lock())
  expect(result.current.unlocked).toBe(false);expect(forgetDeviceIdentity).toHaveBeenCalledWith("own@example.com")
})
