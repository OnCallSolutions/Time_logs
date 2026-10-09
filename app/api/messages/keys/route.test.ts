// @vitest-environment node
/**
 * Verifies encryption identity registration and owner-only recovery access.
 * Public identities are synthetic; storage, roster, and authentication are mocked.
 * Recovery passphrases must never be accepted as server-side setup fields.
 */
import { beforeAll,beforeEach,expect,it,vi } from "vitest"
import { createHash,generateKeyPairSync } from "node:crypto"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({employeeRoster:vi.fn(),listMessages:vi.fn()}))
vi.mock("@/lib/message-keys",()=>({ownMessageKey:vi.fn(),publicMessageKeys:vi.fn(),registerMessageKey:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { employeeRoster,listMessages } from "@/lib/collaboration"
import { ownMessageKey,publicMessageKeys,registerMessageKey } from "@/lib/message-keys"
import { resolvePermissions } from "@/lib/permissions"
import { recordAuditEvent } from "@/lib/db"
import { GET,POST } from "./route"
let setup:{publicKey:string;signingKey:string;fingerprint:string;backup:{salt:string;nonce:string;ciphertext:string;iterations:600000}}
beforeAll(()=>{
  const publicKey=generateKeyPairSync("rsa",{modulusLength:3072}).publicKey.export({type:"spki",format:"der"}).toString("base64")
  const signingKey=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({type:"spki",format:"der"}).toString("base64")
  setup={publicKey,signingKey,fingerprint:createHash("sha256").update(`${publicKey}:${signingKey}`).digest("hex"),backup:{salt:Buffer.alloc(16).toString("base64"),nonce:Buffer.alloc(12).toString("base64"),ciphertext:Buffer.alloc(100).toString("base64"),iterations:600000}}
})
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:resolvePermissions("employee")})
  vi.mocked(listMessages).mockResolvedValue([]);vi.mocked(employeeRoster).mockResolvedValue([])
  vi.mocked(publicMessageKeys).mockResolvedValue([]);vi.mocked(ownMessageKey).mockResolvedValue(null)
})
/** @param input - Public identity and encrypted recovery fields. @returns Registration request with JSON body. */
function request(input:object):Request{return new Request("http://localhost/tanovo-time/api/messages/keys",{method:"POST",body:JSON.stringify(input)})}
it("looks up a recovery backup only for the authenticated account",async()=>{
  expect((await GET()).status).toBe(200)
  expect(ownMessageKey).toHaveBeenCalledWith("employee@example.com")
  expect(publicMessageKeys).toHaveBeenCalledWith(["employee@example.com"])
})
it("registers validated public keys but refuses silent key replacement",async()=>{
  vi.mocked(registerMessageKey).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  expect((await POST(request(setup))).status).toBe(201)
  expect(registerMessageKey).toHaveBeenCalledWith("employee@example.com",setup)
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"message_encryption_initialized",metadata:{fingerprint:setup.fingerprint}}))
  expect((await POST(request(setup))).status).toBe(409)
})
it("does not accept recovery passphrases or impersonated owner fields",async()=>{
  expect((await POST(request({...setup,passphrase:"Never send this"}))).status).toBe(400)
  expect((await POST(request({...setup,email:"victim@example.com"}))).status).toBe(400)
  expect(registerMessageKey).not.toHaveBeenCalled()
})
it("rejects modified identity fingerprints",async()=>{
  expect((await POST(request({...setup,fingerprint:"0".repeat(64)}))).status).toBe(400)
  expect(registerMessageKey).not.toHaveBeenCalled()
})
it("denies revoked accounts before returning or registering keys",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:null,permissions:resolvePermissions(null)})
  expect((await GET()).status).toBe(403)
  expect((await POST(request(setup))).status).toBe(403)
  expect(ownMessageKey).not.toHaveBeenCalled();expect(registerMessageKey).not.toHaveBeenCalled()
})
