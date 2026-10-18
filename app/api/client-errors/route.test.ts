import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/audit",()=>({getAuditContext:vi.fn(()=>({ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/api/client-errors",requestId:null}))}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {recordAuditEvent} from "@/lib/db"
import {POST} from "./route"

const payload={reference:"e4b21455-ca7d-468c-aee9-3b6a9d3767ea",operation:"entry.submit",route:"/api/entries/[id]",method:"PATCH",status:503,code:"42P18",message:"Save failed for person@example.com"}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)})
it("stores sanitized failure context in the audit timeline",async()=>{
  const response=await POST(new Request("http://localhost/api/client-errors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}))
  expect(response.status).toBe(202)
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({action:"client_error_reported",targetId:payload.reference,metadata:expect.objectContaining({message:"Save failed for [redacted email]",httpStatus:503,errorCode:"42P18",httpMethod:"PATCH"})}))
})
it("requires an active account and validates client-provided diagnostics",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:null,permissions:{}} as never)
  expect((await POST(new Request("http://localhost/api/client-errors",{method:"POST",body:JSON.stringify(payload)}))).status).toBe(401)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  expect((await POST(new Request("http://localhost/api/client-errors",{method:"POST",body:JSON.stringify({...payload,route:"/api/entries?secret=x"})}))).status).toBe(400)
  expect(recordAuditEvent).not.toHaveBeenCalled()
})
