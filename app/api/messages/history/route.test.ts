// @vitest-environment node
/**
 * Verifies authenticated signed history transfer at the API boundary.
 * Real ephemeral signatures are used; persistence and sessions are isolated.
 * Cross-device access never accepts caller-supplied private material or account roles.
 */
import {beforeAll,beforeEach,expect,it,vi} from "vitest"
import {webcrypto} from "node:crypto"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/message-keys",()=>({publicMessageKeys:vi.fn()}))
vi.mock("@/lib/message-history-store",()=>({historyPage:vi.fn(async()=>[]),historyShares:vi.fn(async()=>[]),saveHistoryShare:vi.fn(async()=>true)}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {publicMessageKeys} from "@/lib/message-keys"
import {saveHistoryShare,historyPage} from "@/lib/message-history-store"
import {createDeviceIdentity,encryptMessage,type PublicMessageKey} from "@/lib/message-crypto"
import {createHistoryShare,type HistoryShare} from "@/lib/message-history-crypto"
import {resolvePermissions} from "@/lib/permissions"
import {GET,POST} from "./route"
const owner="own@example.com"
let keys:PublicMessageKey[],share:HistoryShare
beforeAll(async()=>{
  vi.stubGlobal("crypto",webcrypto)
  const first=await createDeviceIdentity(),second=await createDeviceIdentity()
  keys=[{email:owner,...first},{email:owner,...second}]
  const payload=await encryptMessage("Private",first,owner,owner,owner,[keys[0]],true)
  share=await createHistoryShare(crypto.randomUUID(),payload,first,owner,keys[0],keys[1])
},30000)
beforeEach(()=>{
  vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:owner}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:resolvePermissions("contractor")})
  vi.mocked(publicMessageKeys).mockResolvedValue(keys)
})
/** @param value - Transfer payload override. @returns Request with one signed device-key relay. */
function request(value=share){return new Request("http://localhost/api/messages/history",{method:"POST",body:JSON.stringify({shares:[value]})})}
it("accepts a valid signed transfer between enrolled own devices",async()=>{
  expect((await POST(request())).status).toBe(200)
  expect(saveHistoryShare).toHaveBeenCalledWith(owner,share)
})
it("rejects tampering and unknown destination devices before persistence",async()=>{
  expect((await POST(request({...share,targetFingerprint:"0".repeat(64)}))).status).toBe(403)
  expect((await POST(request({...share,wrapped:share.wrapped.replace(/^./,share.wrapped[0]==="A"?"B":"A")}))).status).toBe(403)
  expect(saveHistoryShare).not.toHaveBeenCalled()
})
it("rejects revoked access before history storage or key discovery",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:null,permissions:resolvePermissions(null)})
  expect((await POST(request())).status).toBe(403)
  expect(publicMessageKeys).not.toHaveBeenCalled()
})
it("does not reveal history to an unregistered target fingerprint",async()=>{
  const response=await GET(new Request(`http://localhost/api/messages/history?device=${"0".repeat(64)}`))
  expect(response.status).toBe(403);expect(historyPage).not.toHaveBeenCalled()
})
