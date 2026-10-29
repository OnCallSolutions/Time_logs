import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({listPatronAccountActivity:vi.fn(),acknowledgePatronAccountActivity:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {acknowledgePatronAccountActivity,listPatronAccountActivity} from "@/lib/db"
import {GET,POST} from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  vi.mocked(listPatronAccountActivity).mockResolvedValue([])
  vi.mocked(acknowledgePatronAccountActivity).mockResolvedValue(true)
})
it("returns the signed-in patron's scoped activity without caching",async()=>{
  const response=await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(listPatronAccountActivity).toHaveBeenCalledWith("contractor@example.com")
})
it("rejects inactive or unauthenticated patrons",async()=>{
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:null,permissions:{}} as never)
  expect((await GET()).status).toBe(401)
  expect(listPatronAccountActivity).not.toHaveBeenCalled()
})
it("acknowledges only a valid event for the authenticated patron",async()=>{
  const response=await POST(new Request("http://localhost/api/account-activity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:"123e4567-e89b-42d3-a456-426614174000"})}))
  expect(response.status).toBe(200)
  expect(acknowledgePatronAccountActivity).toHaveBeenCalledWith("contractor@example.com","123e4567-e89b-42d3-a456-426614174000")
})
it("rejects invalid and inaccessible activity acknowledgments",async()=>{
  const invalid=await POST(new Request("http://localhost/api/account-activity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:"bad-id"})}))
  expect(invalid.status).toBe(400)
  vi.mocked(acknowledgePatronAccountActivity).mockResolvedValue(false)
  const missing=await POST(new Request("http://localhost/api/account-activity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:"123e4567-e89b-42d3-a456-426614174000"})}))
  expect(missing.status).toBe(404)
})
