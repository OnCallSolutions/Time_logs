/**
 * Verifies automatic public-only device enrollment without a recovery form.
 * Concurrent mounts reuse enrollment; verified historical identities stay intact.
 */
import { beforeEach,afterEach,expect,it,vi } from "vitest"
vi.mock("./message-device-store",()=>({loadDeviceIdentity:vi.fn(),rememberDeviceIdentity:vi.fn()}))
vi.mock("./message-crypto",()=>({createDeviceIdentity:vi.fn()}))
import { loadDeviceIdentity,rememberDeviceIdentity } from "./message-device-store"
import { createDeviceIdentity } from "./message-crypto"
import { automaticMessageIdentity } from "./message-device-setup"
const identity={deviceId:"123e4567-e89b-42d3-a456-426614174000",publicKey:"public",signingKey:"signing",fingerprint:"fingerprint",encryption:{extractable:false},signing:{extractable:false}} as never
beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadDeviceIdentity).mockResolvedValue(null);vi.mocked(createDeviceIdentity).mockResolvedValue(identity);vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({ok:true}))))})
afterEach(()=>vi.unstubAllGlobals())
it("enrolls automatically and never sends private keys or a passphrase",async()=>{
  const first=automaticMessageIdentity("own@example.com",[]),second=automaticMessageIdentity("own@example.com",[])
  expect(first).toBe(second);expect(await first).toBe(identity)
  expect(rememberDeviceIdentity).toHaveBeenCalledWith("own@example.com",identity)
  const body=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
  expect(Object.keys(body).sort()).toEqual(["deviceId","fingerprint","publicKey","signingKey"])
})
it("retains a verified identity without replacing it",async()=>{
  vi.mocked(loadDeviceIdentity).mockResolvedValue(identity)
  expect(await automaticMessageIdentity("own@example.com",[{email:"own@example.com",publicKey:"public",signingKey:"signing",fingerprint:"fingerprint"}])).toBe(identity)
  expect(fetch).not.toHaveBeenCalled();expect(createDeviceIdentity).not.toHaveBeenCalled()
})
