/** Keeps AI operational telemetry visible to admins only and uncached. */
import { beforeEach,expect,it,vi } from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/assistant-security",()=>({listAssistantRuns:vi.fn()}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAssistantRuns } from "@/lib/assistant-security"
import { GET } from "./route"

beforeEach(()=>{vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin"} as never);vi.mocked(listAssistantRuns).mockResolvedValue([{id:"123e4567-e89b-42d3-a456-426614174000",status:"succeeded"}] as never)})
it("returns sanitized run events to admins without caching",async()=>{
  const response=await GET(new Request("https://app.example/api/assistant/runs?limit=25"))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(await response.json()).toMatchObject({runs:[{id:"123e4567-e89b-42d3-a456-426614174000"}]})
  expect(listAssistantRuns).toHaveBeenCalledWith(25,undefined)
})
it("does not expose AI telemetry to non-admin patrons",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager"} as never)
  const response=await GET(new Request("https://app.example/api/assistant/runs"))
  expect(response.status).toBe(403)
  expect(listAssistantRuns).not.toHaveBeenCalled()
})
