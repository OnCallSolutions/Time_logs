import {expect,it} from "vitest"
import {stepUpCookiePolicies} from "./step-up-cookie-policy"

it("allows hosted OAuth security cookies on Microsoft's cross-site callback",()=>{
  const policies=stepUpCookiePolicies(true)
  expect(policies.oauth).toEqual({httpOnly:true,sameSite:"none",path:"/",secure:true})
  expect(policies.standard.sameSite).toBe("lax")
})

it("keeps local HTTP OAuth cookies compatible with browser security rules",()=>{
  const policies=stepUpCookiePolicies(false)
  expect(policies.oauth).toEqual({httpOnly:true,sameSite:"lax",path:"/",secure:false})
})
