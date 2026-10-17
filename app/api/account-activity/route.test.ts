import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/db",()=>({listPatronAccountActivity:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {listPatronAccountActivity} from "@/lib/db"
import {GET} from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"contractor@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"contractor",permissions:{}} as never)
  vi.mocked(listPatronAccountActivity).mockResolvedValue([])
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
