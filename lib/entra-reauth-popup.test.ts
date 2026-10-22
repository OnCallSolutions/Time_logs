/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest"
import {openEntraReauthentication} from "./entra-reauth-popup"

afterEach(()=>vi.unstubAllGlobals())

it("opens the same-origin verification starter in a dedicated popup page",()=>{
  const popup={location:{href:"about:blank"},close:vi.fn()} as unknown as Window
  const open=vi.fn(()=>popup)
  vi.stubGlobal("open",open)
  const onFailure=vi.fn()
  const state="123e4567-e89b-42d3-a456-426614174000"
  expect(openEntraReauthentication(state,onFailure)).toBe(popup)
  expect(open).toHaveBeenCalledWith("about:blank","tanovo-microsoft-step-up",expect.stringMatching(/^popup,width=380,height=500,left=-?\d+,top=-?\d+,resizable=yes,scrollbars=yes$/))
  expect(popup.location.href).toBe(`http://localhost:3000/tanovo-time/reauth-start?state=${state}`)
  expect(onFailure).not.toHaveBeenCalled()
})

it("closes the popup and reports a navigation failure",()=>{
  const popup={location:{set href(_value:string){throw new Error("blocked")}},close:vi.fn()} as unknown as Window
  vi.stubGlobal("open",vi.fn(()=>popup))
  const onFailure=vi.fn()
  openEntraReauthentication("123e4567-e89b-42d3-a456-426614174000",onFailure)
  expect(onFailure).toHaveBeenCalledOnce()
  expect(popup.close).toHaveBeenCalledOnce()
})
