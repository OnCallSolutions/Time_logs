/**
 * Tests scoped reviewer delegation and encrypted-notice boundaries with mocked storage.
 * No live identities, plaintext persistence, cryptographic bypass, or database changes.
 */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn()}))
vi.mock("@/lib/db",()=>({getTimeEntry:vi.fn(),recordAuditEvent:vi.fn()}))
vi.mock("@/lib/review-requests",()=>({createReviewRequests:vi.fn(),listReviewRequests:vi.fn()}))
vi.mock("@/lib/message-envelope",async()=>({encryptedMessageSchema:(await import("zod")).z.object({ciphertext:(await import("zod")).z.string()}),validateEnvelope:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { getTimeEntry } from "@/lib/db"
import { createReviewRequests } from "@/lib/review-requests"
import { validateEnvelope } from "@/lib/message-envelope"
import { resolvePermissions } from "@/lib/permissions"
import { POST } from "./route"
const id="20000000-0000-4000-8000-000000000001",messageId="20000000-0000-4000-8000-000000000002"
/** @returns Request containing only exact evidence references and signed ciphertext. */
function request(recipient="helper@example.com"){return new Request("http://localhost/api/review-requests",{method:"POST",body:JSON.stringify({selection:[{id,revision:"original"}],recipient,messageId,encrypted:{ciphertext:"encrypted"}})})}
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"owner@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  vi.mocked(getTimeEntry).mockResolvedValue({id,ownerEmail:"owner@example.com",status:"submitted",revision:"original"} as never)
  vi.mocked(validateEnvelope).mockResolvedValue(true);vi.mocked(createReviewRequests).mockResolvedValue(1)
})
it("requests independent review of the manager's own personal submission",async()=>{
  expect((await POST(request())).status).toBe(201)
  expect(createReviewRequests).toHaveBeenCalledWith([{id,revision:"original"}],"owner@example.com","helper@example.com",messageId,{ciphertext:"encrypted"})
})
it("never grants access without a valid encrypted participant envelope",async()=>{
  vi.mocked(validateEnvelope).mockResolvedValue(false)
  expect((await POST(request())).status).toBe(400)
  expect(createReviewRequests).not.toHaveBeenCalled()
})
it("blocks requesting oneself or an evidence owner",async()=>{
  expect((await POST(request("owner@example.com"))).status).toBe(403)
  vi.mocked(getTimeEntry).mockResolvedValue({id,ownerEmail:"helper@example.com",status:"submitted",revision:"original"} as never)
  expect((await POST(request())).status).toBe(409)
  expect(createReviewRequests).not.toHaveBeenCalled()
})
it("respects explicit denial of the request/delegation right",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{request_review_help:false})})
  expect((await POST(request())).status).toBe(403)
  expect(createReviewRequests).not.toHaveBeenCalled()
})
it("returns conflict instead of claiming success if the atomic write finds stale evidence",async()=>{
  vi.mocked(createReviewRequests).mockResolvedValue(0)
  expect((await POST(request())).status).toBe(409)
})
