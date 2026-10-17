/**
 * Verifies administrator-only recovery before any privileged key use occurs.
 * Configuration absence fails closed and never invents recoverable history.
 * Real key rewrapping is covered by the isolated crypto primitive tests.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/message-keys",()=>({publicMessageKeys:vi.fn(async()=>[])}))
vi.mock("@/lib/message-history-store",()=>({historyPage:vi.fn(),historyShares:vi.fn(),saveHistoryShare:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
vi.mock("@/lib/message-organization-recovery",()=>({organizationRecoveryKeys:vi.fn(()=>[]),recoverHistoryKey:vi.fn()}))
import {auth} from "@/auth"
import {getEffectiveUserRole} from "@/lib/access"
import {recoverHistoryKey} from "@/lib/message-organization-recovery"
import {publicMessageKeys} from "@/lib/message-keys"
import {GET,POST} from "./route"
beforeEach(()=>{vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"actor@example.com"}} as never)})
it("blocks managers from inspecting recovery or recovering keys",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await GET(new Request("http://localhost/api/messages/recovery?email=other@example.com"))).status).toBe(403)
  expect((await POST(new Request("http://localhost/api/messages/recovery",{method:"POST",body:"{}"}))).status).toBe(403)
  expect(publicMessageKeys).not.toHaveBeenCalled();expect(recoverHistoryKey).not.toHaveBeenCalled()
})
it("fails closed when organization recovery is not configured",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  const response=await POST(new Request("http://localhost/api/messages/recovery",{method:"POST",body:JSON.stringify({email:"other@example.com",target:"a".repeat(64)})}))
  expect(response.status).toBe(409);expect(recoverHistoryKey).not.toHaveBeenCalled()
})
