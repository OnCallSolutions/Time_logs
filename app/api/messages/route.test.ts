/**
 * Tests authenticated inbox scoping and sender rights without real message storage.
 * Private-recipient visibility remains enforced by the SQL accessor.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({employeeRoster:vi.fn(),listMessages:vi.fn(),sendMessage:vi.fn(),readMessages:vi.fn(),changeMessage:vi.fn(),editableMessage:vi.fn()}))
vi.mock("@/lib/message-keys",()=>({publicMessageKeys:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {listMessages,sendMessage,employeeRoster,readMessages,changeMessage,editableMessage} from "@/lib/collaboration"
import {resolvePermissions} from "@/lib/permissions"
import {GET,POST,PATCH,DELETE} from "./route"
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
const messageId="123e4567-e89b-42d3-a456-426614174000"
/** @param method - Mutation method. @param body - JSON action fields. @returns Request for the message route. */
function request(method:string,body:object):Request{return new Request("http://localhost/timelog/api/messages",{method,body:JSON.stringify(body)})}
it("records read receipts with authenticated identity rather than request identity",async()=>{
  expect((await PATCH(request("PATCH",{action:"read",ids:[messageId],email:"victim@example.com"}))).status).toBe(200)
  expect(readMessages).toHaveBeenCalledWith("employee@example.com",true,[messageId])
})
it("does not allow a recipient to edit or delete another sender's message",async()=>{
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Changed"}))).status).toBe(403)
  expect((await DELETE(request("DELETE",{id:messageId}))).status).toBe(403)
  expect(changeMessage).not.toHaveBeenCalled()
})
it("rejects an expired sender edit",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(editableMessage).mockResolvedValue({sender_email:"employee@example.com",recipient_email:null} as never)
  vi.mocked(changeMessage).mockResolvedValue(false)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Changed"}))).status).toBe(409)
})
it("passes administrator deadline exemption to scoped storage",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(editableMessage).mockResolvedValue({sender_email:"employee@example.com",recipient_email:null} as never)
  vi.mocked(changeMessage).mockResolvedValue(true)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Changed"}))).status).toBe(200)
  expect(changeMessage).toHaveBeenCalledWith("employee@example.com",true,messageId,"Changed",undefined)
})
it("refuses downgrading encrypted messages to plaintext",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(editableMessage).mockResolvedValue({encrypted_payload:{keys:{}}} as never)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Plaintext"}))).status).toBe(400)
  expect(changeMessage).not.toHaveBeenCalled()
})
it("rejects invalid IDs without querying storage",async()=>{
  expect((await PATCH(request("PATCH",{action:"read",ids:["invalid"]}))).status).toBe(400)
  expect(readMessages).not.toHaveBeenCalled()
})
