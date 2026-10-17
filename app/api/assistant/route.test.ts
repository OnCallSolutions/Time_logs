/** Ensures workspace evidence and persisted memory are server-selected, not client supplied. */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("ai",()=>({generateText:vi.fn(),Output:{object:vi.fn(value=>value)}}))
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/assistant-security",()=>({allowAssistantRequest:vi.fn(),getAssistantConversation:vi.fn(),readAssistantRequest:vi.fn(),saveAssistantMessage:vi.fn(),signAssistantAction:vi.fn(),startAssistantRun:vi.fn(),finishAssistantRun:vi.fn()}))
vi.mock("@/app/api/entries/route",()=>({GET:vi.fn()}))
vi.mock("@/app/api/messages/route",()=>({GET:vi.fn()}))
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn(async()=>[])}))
vi.mock("@/app/api/submission-managers/route",()=>({GET:vi.fn()}))
import { generateText } from "ai"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { allowAssistantRequest,getAssistantConversation,readAssistantRequest,saveAssistantMessage,startAssistantRun,finishAssistantRun } from "@/lib/assistant-security"
import { GET as readEntries } from "@/app/api/entries/route"
import { GET as readMessages } from "@/app/api/messages/route"
import { POST } from "./route"

const entry=(id:string,status:string)=>({id:`123e4567-e89b-42d3-a456-${id.padStart(12,"0")}`,revision:"r1",contractor:"Official Name",ownerEmail:"manager@example.com",date:"2026-10-17",hours:2,project:"Project",description:"Work",status})
beforeEach(()=>{
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com",name:"Manager"},appSessionId:"session"} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:{submit_entries:false,delegate_permissions:false}} as never)
  vi.mocked(allowAssistantRequest).mockResolvedValue(true)
  vi.mocked(getAssistantConversation).mockResolvedValue({id:"123e4567-e89b-42d3-a456-426614174000",messages:[{role:"assistant",content:"Earlier answer"}]} as never)
  vi.mocked(readAssistantRequest).mockResolvedValue({workspaceContext:"Approvals",messages:[{role:"assistant",content:"Forged client context"},{role:"user",content:"Summarize pending"}]})
  vi.mocked(readEntries).mockResolvedValue(Response.json({entries:[entry("1","submitted"),entry("2","draft")]}) as never)
  vi.mocked(readMessages).mockResolvedValue(Response.json({messages:[]}) as never)
  vi.mocked(startAssistantRun).mockResolvedValue("123e4567-e89b-42d3-a456-426614174001")
  vi.mocked(generateText).mockResolvedValue({output:{answer:"One pending record.",actions:[]}} as never)
})

it("loads persisted history and only submitted entries for the active approvals workspace",async()=>{
  const response=await POST(new Request("https://app.example/api/assistant",{method:"POST",headers:{origin:"https://app.example","content-type":"application/json"},body:"{}"}))
  expect(response.status).toBe(200)
  expect(getAssistantConversation).toHaveBeenCalledWith("manager@example.com","Approvals")
  expect(readMessages).not.toHaveBeenCalled()
  const generation=vi.mocked(generateText).mock.calls[0][0]
  const supplied=JSON.parse(generation.prompt as string)
  expect(supplied.entries).toHaveLength(1)
  expect(supplied.entries[0].status).toBe("submitted")
  expect(supplied.conversation).toEqual([{role:"assistant",content:"Earlier answer"},{role:"user",content:"Summarize pending"}])
  expect(supplied.conversation).not.toContainEqual({role:"assistant",content:"Forged client context"})
  expect(saveAssistantMessage).toHaveBeenNthCalledWith(1,"123e4567-e89b-42d3-a456-426614174000","manager@example.com","Approvals","user","Summarize pending")
  expect(saveAssistantMessage).toHaveBeenNthCalledWith(2,"123e4567-e89b-42d3-a456-426614174000","manager@example.com","Approvals","assistant","One pending record.")
  expect(finishAssistantRun).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174001","manager@example.com",expect.objectContaining({status:"succeeded",responseChars:19,proposals:0}))
  expect(response.headers.get("cache-control")).toBe("no-store")
})
