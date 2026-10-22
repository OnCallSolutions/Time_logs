/**
 * Verifies avatar privacy follows authenticated message participation.
 * Profile images are never available from a guessed email alone.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({canViewMessageProfile:vi.fn()}))
vi.mock("@/lib/db",()=>({getUserProfile:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {canViewMessageProfile} from "@/lib/collaboration"
import {getUserProfile} from "@/lib/db"
import {GET} from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"viewer@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:{} as never})
})

it("returns a private cached image only for a shared participant",async()=>{
  vi.mocked(canViewMessageProfile).mockResolvedValue(true)
  vi.mocked(getUserProfile).mockResolvedValue({displayName:"Private nickname",imageDataUrl:"data:image/png;base64,aGVsbG8="})
  const response=await GET(new Request("http://localhost/api/messages/avatar?email=peer%40example.com"))
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("image/png")
  expect(response.headers.get("cache-control")).toContain("private")
  expect(await response.text()).toBe("hello")
  expect(canViewMessageProfile).toHaveBeenCalledWith("viewer@example.com","peer@example.com",true)
})

it("does not reveal whether an unrelated account has a profile image",async()=>{
  vi.mocked(canViewMessageProfile).mockResolvedValue(false)
  const response=await GET(new Request("http://localhost/api/messages/avatar?email=peer%40example.com"))
  expect(response.status).toBe(404)
  expect(getUserProfile).not.toHaveBeenCalled()
})
