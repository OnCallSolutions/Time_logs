import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("@/lib/app-sessions",()=>({isAppSessionFresh:vi.fn()}))
vi.mock("@/lib/preview-data-reset",()=>({resetPreviewData:vi.fn()}))
import {auth} from "@/auth"
import {getEffectivePermissions} from "@/lib/effective-permissions"
import {isAppSessionFresh} from "@/lib/app-sessions"
import {resetPreviewData} from "@/lib/preview-data-reset"
import {POST} from "./route"

function request(confirmation="RESET PREVIEW DATA"){
  return new Request("https://preview.example/api/admin/preview-reset",{method:"POST",headers:{origin:"https://preview.example","content-type":"application/json"},body:JSON.stringify({confirmation})})
}

beforeEach(()=>{
  vi.resetAllMocks()
  vi.stubEnv("VERCEL_ENV","preview")
  vi.stubEnv("TANOVO_DATABASE_ENVIRONMENT","preview")
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"},appSessionId:"fresh-session"} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"admin"} as never)
  vi.mocked(isAppSessionFresh).mockResolvedValue(true)
  vi.mocked(resetPreviewData).mockResolvedValue({timesheets:2,auditEvents:4} as never)
})

it("resets only after exact confirmation, admin authorization and fresh Entra session",async()=>{
  const response=await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ok:true,deleted:{timesheets:2,auditEvents:4}})
  expect(resetPreviewData).toHaveBeenCalledWith("admin@example.com",expect.any(Request))
})

it("refuses all non-preview deployments",async()=>{
  vi.stubEnv("VERCEL_ENV","production")
  expect((await POST(request())).status).toBe(403)
  expect(resetPreviewData).not.toHaveBeenCalled()
  vi.stubEnv("VERCEL_ENV","preview")
  vi.stubEnv("TANOVO_DATABASE_ENVIRONMENT","production")
  expect((await POST(request())).status).toBe(403)
  expect(resetPreviewData).not.toHaveBeenCalled()
})

it("requires a fresh session and exact phrase before any mutation",async()=>{
  vi.mocked(isAppSessionFresh).mockResolvedValue(false)
  expect((await POST(request())).status).toBe(428)
  expect(resetPreviewData).not.toHaveBeenCalled()
  vi.mocked(isAppSessionFresh).mockResolvedValue(true)
  expect((await POST(request("reset it"))).status).toBe(400)
  expect(resetPreviewData).not.toHaveBeenCalled()
})
