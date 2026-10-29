/** Verifies conversation bootstrap is authenticated, same-origin, and no-store. */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/assistant-security",()=>({getAssistantConversation:vi.fn(),readAssistantRequest:vi.fn(async(request:Request)=>request.json())}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAssistantConversation } from "@/lib/assistant-security"
import { POST } from "./route"

beforeEach(()=>{vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"patron@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never);vi.mocked(getAssistantConversation).mockResolvedValue({id:"123e4567-e89b-42d3-a456-426614174000",messages:[{role:"user",content:"last question"}]} as never)})
function request(body:unknown){return new Request("https://app.example/api/assistant/conversations",{method:"POST",headers:{origin:"https://app.example","content-type":"application/json"},body:JSON.stringify(body)})}

it("returns only the authenticated actor's recent workspace conversation without caching",async()=>{
  const response=await POST(request({workspaceContext:"Timesheets"}))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(await response.json()).toMatchObject({id:"123e4567-e89b-42d3-a456-426614174000",messages:[{role:"user",content:"last question"}]})
  expect(getAssistantConversation).toHaveBeenCalledWith("patron@example.com","Timesheets")
})
it("rejects malformed workspace keys before reading conversation storage",async()=>{
  const response=await POST(request({workspaceContext:"../other-company"}))
  expect(response.status).toBe(400)
  expect(getAssistantConversation).not.toHaveBeenCalled()
})
it("requires a signed-in actor",async()=>{
  vi.mocked(auth).mockResolvedValue(null as never)
  const response=await POST(request({workspaceContext:"Reports"}))
  expect(response.status).toBe(401)
  expect(getAssistantConversation).not.toHaveBeenCalled()
})
