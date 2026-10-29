/**
 * Checks server session activity cannot be renewed by polling or another origin.
 * Authenticated identity is taken from the session, never a submitted browser ID.
 * Revoked/expired sessions remain expired and never create replacement sessions.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/app-sessions",()=>({readAppSession:vi.fn()}))
import {auth} from "@/auth"
import {readAppSession} from "@/lib/app-sessions"
import {GET,POST} from "./route"
beforeEach(()=>{vi.clearAllMocks();vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"},appSessionId:"trusted-session"} as never);vi.mocked(readAppSession).mockResolvedValue({expiresAt:"2026-10-15T12:30:00Z",absoluteExpiresAt:"2026-10-15T20:00:00Z"})})
it("polls the deadline without touching last activity",async()=>{
  expect((await GET()).status).toBe(200)
  expect(readAppSession).toHaveBeenCalledWith("trusted-session","person@example.com",false)
})
it("only extends explicit same-origin activity using the authenticated session ID",async()=>{
  const response=await POST(new Request("http://localhost:3000/tanovo-time/api/session-activity",{method:"POST",headers:{origin:"http://localhost:3000"},body:JSON.stringify({id:"forged"})}))
  expect(response.status).toBe(200);expect(readAppSession).toHaveBeenCalledWith("trusted-session","person@example.com",true)
})
it("rejects missing or cross-origin activity before touching storage",async()=>{
  for(const origin of [null,"https://untrusted.example"]){
    expect((await POST(new Request("http://localhost:3000/api/session-activity",{method:"POST",headers:origin?{origin}:{}}))).status).toBe(403)
  }
  expect(readAppSession).not.toHaveBeenCalled()
})
it("does not revive expired or legacy sessions",async()=>{
  vi.mocked(readAppSession).mockResolvedValue(null)
  expect((await GET()).status).toBe(401)
  vi.mocked(auth).mockResolvedValue({user:{email:"person@example.com"}} as never)
  expect((await GET()).status).toBe(401)
})
