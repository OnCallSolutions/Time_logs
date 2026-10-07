/**
 * Tests authenticated inbox scoping and sender rights without real message storage.
 * Private-recipient visibility remains enforced by the SQL accessor.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({employeeRoster:vi.fn(),listMessages:vi.fn(),sendMessage:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {listMessages,sendMessage,employeeRoster} from "@/lib/collaboration"
import {resolvePermissions} from "@/lib/permissions"
import {GET,POST} from "./route"
beforeEach(()=>{vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:resolvePermissions("employee")});vi.mocked(listMessages).mockResolvedValue([])})
it("loads only the authenticated employee inbox and eligible broadcasts",async()=>{
  expect((await GET()).status).toBe(200)
  expect(listMessages).toHaveBeenCalledWith("employee@example.com",true)
})
it("denies employee broadcast sending",async()=>{
  expect((await POST(new Request("http://localhost/timelog/api/messages",{method:"POST",body:JSON.stringify({recipient:null,body:"Announcement"})}))).status).toBe(403)
  expect(sendMessage).not.toHaveBeenCalled()
})
it("rejects a private message to an ineligible recipient",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(employeeRoster).mockResolvedValue([])
  expect((await POST(new Request("http://localhost/timelog/api/messages",{method:"POST",body:JSON.stringify({recipient:"admin@example.com",body:"Hello"})}))).status).toBe(400)
  expect(sendMessage).not.toHaveBeenCalled()
})
it("denies sending immediately after manager sending rights are revoked",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_messages:false})})
  expect((await POST(new Request("http://localhost/timelog/api/messages",{method:"POST",body:JSON.stringify({recipient:null,body:"Announcement"})}))).status).toBe(403)
  expect(sendMessage).not.toHaveBeenCalled()
})
