import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/issues",requestId:null}))}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
vi.mock("@/lib/issues-store",()=>({createIssue:vi.fn(),getIssueSummary:vi.fn(),listIssues:vi.fn(),listReporterIssues:vi.fn(),updateIssue:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { recordAuditEvent } from "@/lib/db"
import { createIssue, getIssueSummary, listIssues,listReporterIssues, updateIssue } from "@/lib/issues-store"
import { GET, PATCH, POST } from "./route"

const payload={reference:"e4b21455-ca7d-468c-aee9-3b6a9d3767ea",operation:"entry.submit",route:"/api/entries/[id]",status:503,message:"Save failed for person@example.com",details:"The confirmation dialog never closed."}
const issue={id:"a4b21455-ca7d-468c-aee9-3b6a9d3767ea",reference:payload.reference,reporterEmail:"person@example.com",operation:payload.operation,route:payload.route,errorSignature:"signature",similarReports:1,httpStatus:503,errorMessage:"Save failed for [redacted email]",details:payload.details,status:"open" as const,priority:"normal" as const,internalNote:"",category:"other" as const,assignedTo:null,publicReply:"",createdAt:"2026-10-17T10:00:00.000Z",updatedAt:"2026-10-17T10:00:00.000Z",updatedBy:null}

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  vi.mocked(createIssue).mockResolvedValue({issue,created:true,ownerMatches:true})
  vi.mocked(listIssues).mockResolvedValue([issue] as never)
  vi.mocked(listReporterIssues).mockResolvedValue([{id:issue.id,reference:issue.reference,operation:issue.operation,status:issue.status,priority:issue.priority,publicReply:"We are investigating.",createdAt:issue.createdAt,updatedAt:issue.updatedAt}] as never)
  vi.mocked(getIssueSummary).mockResolvedValue({open:1,urgent:0,uniqueErrors:1})
  vi.mocked(updateIssue).mockImplementation(async input=>({...issue,status:input.status,priority:input.priority,internalNote:input.internalNote}) as never)
})

it("lets patrons see only their safe case status and public update",async()=>{
  const response=await GET(new Request("https://app.example/api/issues?mine=1"))
  expect(response.status).toBe(200)
  expect(listReporterIssues).toHaveBeenCalledWith("person@example.com")
  expect((await response.json()).issues[0]).not.toHaveProperty("internalNote")
})

it("accepts an authenticated patron report with read-only error context and notes",async()=>{
  const response=await POST(new Request("https://app.example/api/issues",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}))
  expect(response.status).toBe(201)
  expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({reporterEmail:"person@example.com",operation:payload.operation,route:payload.route,errorSignature:expect.any(String),details:payload.details,errorMessage:"Save failed for [redacted email]"}))
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"user_issue_submitted",metadata:expect.objectContaining({reporterDetails:payload.details})}))
})

it("rejects patron-controlled triage fields",async()=>{
  const response=await POST(new Request("https://app.example/api/issues",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,status:"resolved",priority:"urgent"})}))
  expect(response.status).toBe(400)
  expect(createIssue).not.toHaveBeenCalled()
})

it("returns issue reports only to administrators",async()=>{
  const forbidden=await GET(new Request("https://app.example/api/issues"))
  expect(forbidden.status).toBe(403)
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{}} as never)
  const response=await GET(new Request("https://app.example/api/issues?summary=1"))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({summary:{open:1,urgent:0,uniqueErrors:1}})
  expect(response.headers.get("cache-control")).toBe("no-store")
})

it("allows admins to resolve and dequeue an issue while auditing the change",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin",permissions:{}} as never)
  const response=await PATCH(new Request("https://app.example/api/issues",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:issue.id,status:"resolved",priority:"high",internalNote:"Fixed the retry conflict."})}))
  expect(response.status).toBe(200)
  expect(updateIssue).toHaveBeenCalledWith(expect.objectContaining({id:issue.id,status:"resolved",priority:"high",updatedBy:"admin@example.com"}))
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"issue_updated",metadata:expect.objectContaining({previousStatus:"open",status:"resolved",hasInternalNote:true})}))
})
