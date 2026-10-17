/**
 * Tests authenticated inbox scoping and sender rights without real message storage.
 * Private-recipient visibility remains enforced by the SQL accessor.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("@/lib/message-history-store",()=>({historyPage:vi.fn(async()=>[])}))
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn(),listMessages:vi.fn(),sendMessage:vi.fn(),readMessages:vi.fn(),hideMessageFor:vi.fn(),changeMessage:vi.fn(),editableMessage:vi.fn(),getMessagePreferences:vi.fn(async()=>({readReceiptsEnabled:true})),setReadReceiptsEnabled:vi.fn()}))
vi.mock("@/lib/message-keys",()=>({publicMessageKeys:vi.fn()}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {listMessages,sendMessage,actorRoster,readMessages,hideMessageFor,changeMessage,editableMessage,setReadReceiptsEnabled} from "@/lib/collaboration"
import {resolvePermissions} from "@/lib/permissions"
import {listAccountIdentities} from "@/lib/account-identities"
import {GET,POST,PATCH,DELETE} from "./route"
import * as envelopes from "@/lib/message-envelope"
beforeEach(()=>{vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:resolvePermissions("employee")});vi.mocked(listMessages).mockResolvedValue([])})
it("loads only the authenticated employee inbox and eligible broadcasts",async()=>{
  expect((await GET()).status).toBe(200)
  expect(listMessages).toHaveBeenCalledWith("employee@example.com",true)
})
it("uses approved names for company messages instead of personal profile nicknames",async()=>{
  vi.mocked(listMessages).mockResolvedValue([{id:"known",sender_email:"manager@example.com",recipient_email:"employee@example.com",body:"Hello",created_at:"2026-10-15T12:00:00Z"}] as never)
  vi.mocked(listAccountIdentities).mockResolvedValue([{email:"manager@example.com",officialName:"Official Manager",contractorNumber:"TN-one"},{email:"employee@example.com",officialName:"Official Employee",contractorNumber:"TN-two"}])
  const data=await (await GET()).json()
  expect(data.messages[0]).toMatchObject({sender_name:"Official Manager",recipient_name:"Official Employee"})
  expect(JSON.stringify(data)).not.toContain("nickname")
})
it("denies employee broadcast sending",async()=>{
  expect((await POST(new Request("http://localhost/tanovo-time/api/messages",{method:"POST",body:JSON.stringify({recipient:null,body:"Announcement"})}))).status).toBe(403)
  expect(sendMessage).not.toHaveBeenCalled()
})
it("rejects a private message to an ineligible recipient",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(actorRoster).mockResolvedValue([])
  expect((await POST(new Request("http://localhost/tanovo-time/api/messages",{method:"POST",body:JSON.stringify({recipient:"admin@example.com",body:"Hello"})}))).status).toBe(400)
  expect(sendMessage).not.toHaveBeenCalled()
})
it("denies sending immediately after manager sending rights are revoked",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_messages:false})})
  expect((await POST(new Request("http://localhost/tanovo-time/api/messages",{method:"POST",body:JSON.stringify({recipient:null,body:"Announcement"})}))).status).toBe(403)
  expect(sendMessage).not.toHaveBeenCalled()
})
const messageId="123e4567-e89b-42d3-a456-426614174000"
/** @param method - Mutation method. @param body - JSON action fields. @returns Request for the message route. */
function request(method:string,body:object):Request{return new Request("http://localhost/tanovo-time/api/messages",{method,body:JSON.stringify(body)})}
it("records read receipts with authenticated identity rather than request identity",async()=>{
  expect((await PATCH(request("PATCH",{action:"read",ids:[messageId],email:"victim@example.com"}))).status).toBe(200)
  expect(readMessages).toHaveBeenCalledWith("employee@example.com",true,[messageId])
})
it("saves read receipt privacy for the authenticated user only",async()=>{
  const response=await PATCH(request("PATCH",{action:"read_receipts",enabled:false,email:"victim@example.com"}))
  expect(response.status).toBe(200)
  expect(setReadReceiptsEnabled).toHaveBeenCalledWith("employee@example.com",false)
})
it("deletes a message only from the authenticated viewer's inbox",async()=>{
  vi.mocked(hideMessageFor).mockResolvedValue(true)
  const response=await PATCH(request("PATCH",{action:"delete_for_me",id:messageId}))
  expect(response.status).toBe(200)
  expect(hideMessageFor).toHaveBeenCalledWith("employee@example.com",true,messageId)
  expect(changeMessage).not.toHaveBeenCalled()
})
it("unsends for everyone only through the manager sender action",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_messages:true})})
  vi.mocked(changeMessage).mockResolvedValue(true)
  const response=await DELETE(request("DELETE",{id:messageId}))
  expect(response.status).toBe(200)
  expect(changeMessage).toHaveBeenCalledWith("employee@example.com",false,messageId,null)
})
it("returns a conflict when the sender window for unsending has expired",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{send_messages:true})})
  vi.mocked(changeMessage).mockResolvedValue(false)
  expect((await DELETE(request("DELETE",{id:messageId}))).status).toBe(409)
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
it("allows an administrator to edit their own messages after the sender deadline",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(editableMessage).mockResolvedValue({sender_email:"admin@example.com",recipient_email:null} as never)
  vi.mocked(changeMessage).mockResolvedValue(true)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Changed"}))).status).toBe(200)
  expect(changeMessage).toHaveBeenCalledWith("admin@example.com",true,messageId,"Changed",undefined)
})
it("does not let an administrator edit a message sent by someone else",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(editableMessage).mockResolvedValue({sender_email:"employee@example.com",recipient_email:null} as never)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Changed"}))).status).toBe(403)
  expect(changeMessage).not.toHaveBeenCalled()
})
it("refuses downgrading encrypted messages to plaintext",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:resolvePermissions("admin")})
  vi.mocked(editableMessage).mockResolvedValue({sender_email:"admin@example.com",encrypted_payload:{keys:{}}} as never)
  expect((await PATCH(request("PATCH",{action:"edit",id:messageId,body:"Plaintext"}))).status).toBe(400)
  expect(changeMessage).not.toHaveBeenCalled()
})
it("rejects invalid IDs without querying storage",async()=>{
  expect((await PATCH(request("PATCH",{action:"read",ids:["invalid"]}))).status).toBe(400)
  expect(readMessages).not.toHaveBeenCalled()
})
it("validates a manager-only broadcast against exactly the selected active roles",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"lead@example.com",role:"manager",accessStatus:"active",displayName:""},
    {email:"staff@example.com",role:"employee",accessStatus:"active",displayName:""},
    {email:"blocked@example.com",role:"manager",accessStatus:"blocked",displayName:""},
  ])
  const validate=vi.spyOn(envelopes,"validateEnvelope").mockResolvedValue(true)
  vi.mocked(sendMessage).mockResolvedValue(messageId)
  const encrypted={version:1,nonce:"AAAAAAAAAAAAAAAA",ciphertext:"A".repeat(24),sender:"employee@example.com",author:"employee@example.com",recipient:null,token:messageId,signature:"AAAA",keys:{}}
  try {
    const response=await POST(request("POST",{recipient:null,audience:"manager",encrypted}))
    expect(response.status).toBe(201)
    expect(validate).toHaveBeenCalledWith(encrypted,"employee@example.com","employee@example.com",null,["employee@example.com","lead@example.com"])
  } finally {validate.mockRestore()}
})
