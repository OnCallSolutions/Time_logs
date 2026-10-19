import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/client-errors",requestId:null}))}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
vi.mock("@/lib/operational-events",()=>({recordOperationalEvent:vi.fn(),sanitizeOperationalMessage:vi.fn((message:string)=>message.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,"[redacted email]").replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"$1=[redacted]"))}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {recordAuditEvent} from "@/lib/db"
import {recordOperationalEvent} from "@/lib/operational-events"
import {POST} from "./route"

const payload={reference:"e4b21455-ca7d-468c-aee9-3b6a9d3767ea",operation:"entry.submit",route:"/api/entries/[id]",method:"PATCH",status:503,code:"42P18",message:"Save failed for person@example.com"}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)})
it("stores sanitized operational context and a correlated audit pointer",async()=>{
  const response=await POST(new Request("http://localhost/api/client-errors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,message:"Save failed for person@example.com token=secret-value"})}))
  expect(response.status).toBe(202)
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"client_error_reported",targetId:payload.reference,metadata:expect.objectContaining({message:"Save failed for [redacted email] token=[redacted]",httpStatus:503,errorCode:"42P18",httpMethod:"PATCH"})}))
  expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({correlationId:payload.reference,category:"client_error",operation:"entry.submit",route:"/api/entries/[id]",method:"PATCH",httpStatus:503,errorCode:"42P18",message:"Save failed for [redacted email] token=[redacted]"}))
})
it("requires an active account and validates client-provided diagnostics",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:null,permissions:{}} as never)
  expect((await POST(new Request("http://localhost/api/client-errors",{method:"POST",body:JSON.stringify(payload)}))).status).toBe(401)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  expect((await POST(new Request("http://localhost/api/client-errors",{method:"POST",body:JSON.stringify({...payload,route:"/api/entries?secret=x"})}))).status).toBe(400)
  expect(recordAuditEvent).not.toHaveBeenCalled()
  expect(recordOperationalEvent).not.toHaveBeenCalled()
})
it("rejects an oversized streamed report without a Content-Length header",async()=>{
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8193));controller.close()}})
  const request=new Request("http://localhost/api/client-errors",{method:"POST",body,duplex:"half"} as RequestInit)
  expect(request.headers.has("content-length")).toBe(false)
  expect((await POST(request)).status).toBe(413)
})
