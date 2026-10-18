import {beforeEach,expect,it,vi} from "vitest"

const {auth,stepUpAuth,markAppSessionFresh}=vi.hoisted(()=>({auth:vi.fn(),stepUpAuth:vi.fn(),markAppSessionFresh:vi.fn()}))
vi.mock("@/auth",()=>({auth}))
vi.mock("@/step-up-auth",()=>({stepUpAuth,stepUpSessionCookieName:"tanovo-time.stepup.session-token"}))
vi.mock("@/lib/app-sessions",()=>({markAppSessionFresh}))
import {POST} from "./route"

const now=Date.now()
const state="123e4567-e89b-42d3-a456-426614174000"
function request(origin="https://app.example.com"){
  return new Request("https://app.example.com/tanovo-time/api/access-reauth/complete",{
    method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({state}),
  })
}
beforeEach(()=>{
  vi.clearAllMocks()
  vi.spyOn(Date,"now").mockReturnValue(now)
  auth.mockResolvedValue({appSessionId:"123e4567-e89b-42d3-a456-426614174001",user:{email:"Admin@Example.com"}})
  stepUpAuth.mockResolvedValue({stepUpAuthenticatedAt:now,user:{email:"admin@example.com"}})
  markAppSessionFresh.mockResolvedValue(true)
})

it("refreshes only the matching original app session after fresh same-account verification",async()=>{
  const response=await POST(request())
  expect(response.status).toBe(200)
  expect(markAppSessionFresh).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174001","Admin@Example.com")
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
})

it("rejects a different Entra identity without changing app-session freshness",async()=>{
  stepUpAuth.mockResolvedValue({stepUpAuthenticatedAt:now,user:{email:"other@example.com"}})
  expect((await POST(request())).status).toBe(401)
  expect(markAppSessionFresh).not.toHaveBeenCalled()
})

it("rejects stale verification and cross-origin completion",async()=>{
  stepUpAuth.mockResolvedValue({stepUpAuthenticatedAt:now-6*60_000,user:{email:"admin@example.com"}})
  expect((await POST(request())).status).toBe(401)
  expect((await POST(request("https://attacker.example"))).status).toBe(403)
  expect(markAppSessionFresh).not.toHaveBeenCalled()
})

it("does not confirm when the original application session is no longer live",async()=>{
  markAppSessionFresh.mockResolvedValue(false)
  expect((await POST(request())).status).toBe(401)
})
