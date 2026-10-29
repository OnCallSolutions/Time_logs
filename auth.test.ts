/**
 * Inspects real authentication callbacks with isolated Auth.js and session storage.
 * Verifies provider-only session creation, legacy expiry and logout revocation.
 * Client-triggered token updates cannot replace or renew the server session ID.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("next-auth",()=>({default:vi.fn(()=>({auth:vi.fn(),handlers:{},signIn:vi.fn(),signOut:vi.fn()}))}))
vi.mock("@/lib/app-sessions",()=>({createAppSession:vi.fn(),readAppSession:vi.fn(),revokeAppSession:vi.fn()}))
import NextAuth from "next-auth"
import {createAppSession,readAppSession,revokeAppSession} from "@/lib/app-sessions"
import "./auth"
const options=vi.mocked(NextAuth).mock.calls[0][0] as import("next-auth").NextAuthConfig
beforeEach(()=>{vi.clearAllMocks();vi.mocked(createAppSession).mockResolvedValue("new-session");vi.mocked(readAppSession).mockResolvedValue({expiresAt:"live",absoluteExpiresAt:"absolute"})})
it("creates a normalized server session only after provider authentication",async()=>{
  const token=await options.callbacks!.jwt!({token:{email:"PERSON@EXAMPLE.COM"},account:{provider:"microsoft-entra-id"},user:{email:"PERSON@EXAMPLE.COM"}} as never)
  expect(createAppSession).toHaveBeenCalledWith("person@example.com")
  expect(token?.appSessionId).toBe("new-session")
  expect(options.session?.maxAge).toBe(8*3600)
})
it("invalidates old cookies with no bounded session instead of silently renewing",async()=>{
  expect(await options.callbacks!.jwt!({token:{email:"person@example.com"}} as never)).toBeNull()
  expect(createAppSession).not.toHaveBeenCalled()
})
it("ignores forged update IDs and denies revoked server state",async()=>{
  const token=await options.callbacks!.jwt!({token:{email:"person@example.com",appSessionId:"original"},trigger:"update",session:{appSessionId:"forged"}} as never)
  expect(token?.appSessionId).toBe("original");expect(createAppSession).not.toHaveBeenCalled()
  vi.mocked(readAppSession).mockResolvedValue(null)
  expect(await options.callbacks!.jwt!({token:{email:"person@example.com",appSessionId:"original"}} as never)).toBeNull()
})
it("revokes the exact signed session on logout",async()=>{
  await options.events!.signOut!({token:{appSessionId:"original"}} as never)
  expect(revokeAppSession).toHaveBeenCalledWith("original")
})
