/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest"
import {cleanup,render,screen,waitFor} from "@testing-library/react"
import {ReauthenticationStart} from "./reauthentication-start"

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})

it("starts Auth.js from the popup document using a standard form submission",async()=>{
  const submit=vi.spyOn(HTMLFormElement.prototype,"submit").mockImplementation(()=>{})
  const fetch=vi.fn().mockResolvedValue(Response.json({csrfToken:"csrf-fixture"}))
  vi.stubGlobal("fetch",fetch)
  const state="123e4567-e89b-42d3-a456-426614174000"
  render(<ReauthenticationStart state={state}/>)

  await waitFor(()=>expect(submit).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledWith("/tanovo-time/api/auth/csrf?stepup=1",expect.objectContaining({cache:"no-store"}))
  const form=document.querySelector("form")!
  expect(form.method).toBe("post")
  expect(form.action).toBe("http://localhost:3000/tanovo-time/api/auth/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login")
  expect(form.querySelector('[name="csrfToken"]')?.getAttribute("value")).toBe("csrf-fixture")
  expect(form.querySelector('[name="callbackUrl"]')?.getAttribute("value")).toBe(`http://localhost:3000/tanovo-time/reauth-complete?state=${state}`)
})

it("shows a useful startup failure instead of leaving an empty popup",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("network unavailable")))
  render(<ReauthenticationStart state="123e4567-e89b-42d3-a456-426614174000"/>)
  expect(await screen.findByText("Microsoft verification could not start. Close this window and try again.")).toBeTruthy()
})
