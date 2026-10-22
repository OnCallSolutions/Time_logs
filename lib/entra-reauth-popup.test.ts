/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest"
import {openEntraReauthentication} from "./entra-reauth-popup"

afterEach(()=>vi.unstubAllGlobals())

it("opens Entra in a small popup and returns to a same-origin completion page",async()=>{
  const form={appendChild:vi.fn(),submit:vi.fn(),method:"",action:""} as unknown as HTMLFormElement
  const inputs:HTMLInputElement[]=[]
  const popup={
    location:{href:"about:blank"},
    close:vi.fn(),
    document:{
      createElement:vi.fn((tag:string)=>tag==="form"?form:(()=>{const input={type:"",name:"",value:""} as HTMLInputElement;inputs.push(input);return input})()),
      body:{appendChild:vi.fn()},
    },
  } as unknown as Window
  const open=vi.fn(()=>popup)
  vi.stubGlobal("open",open)
  const fetch=vi.fn().mockResolvedValue(Response.json({csrfToken:"csrf-fixture"}))
  vi.stubGlobal("fetch",fetch)
  const onFailure=vi.fn()
  const state="123e4567-e89b-42d3-a456-426614174000"
  expect(openEntraReauthentication(state,onFailure)).toBe(popup)
  await vi.waitFor(()=>expect(form.submit).toHaveBeenCalledOnce())
  expect(open).toHaveBeenCalledWith("about:blank","tanovo-microsoft-step-up",expect.stringMatching(/^popup,width=380,height=500,left=-?\d+,top=-?\d+,resizable=yes,scrollbars=yes$/))
  expect(fetch).toHaveBeenCalledWith("/tanovo-time/api/auth/csrf?stepup=1",expect.objectContaining({cache:"no-store"}))
  expect(form.method).toBe("POST")
  expect(form.action).toBe("/tanovo-time/api/auth/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login")
  expect(inputs).toEqual([
    expect.objectContaining({name:"csrfToken",value:"csrf-fixture",type:"hidden"}),
    expect.objectContaining({name:"callbackUrl",value:`http://localhost:3000/tanovo-time/reauth-complete?state=${state}`,type:"hidden"}),
  ])
  expect(popup.document.body.appendChild).toHaveBeenCalledWith(form)
  expect(onFailure).not.toHaveBeenCalled()
})

it("closes the popup and reports an unavailable isolated auth endpoint",async()=>{
  const popup={location:{href:"about:blank"},close:vi.fn(),document:{}} as unknown as Window
  vi.stubGlobal("open",vi.fn(()=>popup))
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})))
  const onFailure=vi.fn()
  openEntraReauthentication("123e4567-e89b-42d3-a456-426614174000",onFailure)
  await vi.waitFor(()=>expect(onFailure).toHaveBeenCalledOnce())
  expect(popup.close).toHaveBeenCalledOnce()
})
