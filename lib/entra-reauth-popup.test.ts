/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest"
import {openEntraReauthentication} from "./entra-reauth-popup"

afterEach(()=>vi.unstubAllGlobals())

it("opens Entra in a small popup and returns to a same-origin completion page",async()=>{
  const popup={location:{href:"about:blank"},close:vi.fn()} as unknown as Window
  const open=vi.fn(()=>popup)
  const fetch=vi.fn()
  vi.stubGlobal("open",open)
  fetch.mockResolvedValueOnce(Response.json({csrfToken:"csrf-fixture"}))
  fetch.mockResolvedValueOnce(Response.json({url:"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftanovo-time%2Fapi%2Fauth%2Fcallback%2Fmicrosoft-entra-id"}))
  vi.stubGlobal("fetch",fetch)
  const onFailure=vi.fn()
  const state="123e4567-e89b-42d3-a456-426614174000"
  expect(openEntraReauthentication(state,onFailure)).toBe(popup)
  await vi.waitFor(()=>expect(popup.location.href).toContain("login.microsoftonline.com"))
  expect(open).toHaveBeenCalledWith("about:blank","tanovo-microsoft-step-up","popup,width=380,height=500,resizable=yes,scrollbars=yes")
  expect(fetch).toHaveBeenNthCalledWith(1,"/tanovo-time/api/auth/csrf?stepup=1",expect.objectContaining({cache:"no-store"}))
  expect(fetch).toHaveBeenNthCalledWith(2,"/tanovo-time/api/auth/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login",expect.objectContaining({
    method:"POST",headers:expect.objectContaining({"X-Auth-Return-Redirect":"1"}),
    body:expect.any(URLSearchParams),cache:"no-store",
  }))
  const body=fetch.mock.calls[1][1].body as URLSearchParams
  expect(body.get("csrfToken")).toBe("csrf-fixture")
  expect(body.get("callbackUrl")).toBe(`http://localhost:3000/tanovo-time/reauth-complete?state=${state}`)
  expect(popup.location.href).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftanovo-time%2Fapi%2Fauth%2Fcallback%2Fmicrosoft-entra-id")
  expect(onFailure).not.toHaveBeenCalled()
})

it("closes the popup and reports an unavailable isolated auth endpoint",async()=>{
  const popup={location:{href:"about:blank"},close:vi.fn()} as unknown as Window
  vi.stubGlobal("open",vi.fn(()=>popup))
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})))
  const onFailure=vi.fn()
  openEntraReauthentication("123e4567-e89b-42d3-a456-426614174000",onFailure)
  await vi.waitFor(()=>expect(onFailure).toHaveBeenCalledOnce())
  expect(popup.close).toHaveBeenCalledOnce()
})
