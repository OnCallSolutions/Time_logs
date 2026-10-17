/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest"
vi.mock("next-auth/react",()=>({signIn:vi.fn()}))
import {signIn} from "next-auth/react"
import {openEntraReauthentication} from "./entra-reauth-popup"

afterEach(()=>vi.unstubAllGlobals())

it("opens Entra in a small popup and returns to a same-origin completion page",async()=>{
  const popup={location:{href:"about:blank"},close:vi.fn()} as unknown as Window
  const open=vi.fn(()=>popup)
  vi.stubGlobal("open",open)
  vi.mocked(signIn).mockResolvedValue({ok:true,error:undefined,url:"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftanovo-time%2Fapi%2Fauth%2Fcallback%2Fmicrosoft-entra-id"} as never)
  const onFailure=vi.fn()
  const state="123e4567-e89b-42d3-a456-426614174000"
  expect(openEntraReauthentication(state,onFailure)).toBe(popup)
  await vi.waitFor(()=>expect(popup.location.href).toContain("login.microsoftonline.com"))
  expect(open).toHaveBeenCalledWith("about:blank","tanovo-microsoft-step-up","popup,width=480,height=640,resizable=yes,scrollbars=yes")
  expect(signIn).toHaveBeenCalledWith("microsoft-entra-id",expect.objectContaining({redirect:false,redirectTo:expect.stringContaining(`/tanovo-time/reauth-complete?state=${state}`)}),{max_age:"0",prompt:"login"})
  expect(popup.location.href).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftanovo-time%2Fapi%2Fauth%2Fcallback%2Fmicrosoft-entra-id")
  expect(onFailure).not.toHaveBeenCalled()
})
