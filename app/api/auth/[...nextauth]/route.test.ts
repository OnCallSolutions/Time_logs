// @vitest-environment node
/**
 * Verifies public Tanovo Time authentication paths at the real route wrapper.
 * Provider handlers are isolated so tests never contact Microsoft or consume cookies.
 * GET and POST retain their method and payload while restoring the mount prefix.
 */
import { beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/auth", () => ({ handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/step-up-auth", () => ({ handlers: undefined, stepUpHandlers: { GET: vi.fn(), POST: vi.fn() } }))
import { handlers } from "@/auth"
import { stepUpHandlers } from "@/step-up-auth"
import { GET, POST } from "./route"

beforeEach(() => vi.resetAllMocks())

it("restores the public callback prefix without changing the query", () => {
  GET(new NextRequest("http://localhost:3000/api/auth/callback/microsoft-entra-id?code=fixture"))
  const request = vi.mocked(handlers.GET).mock.calls[0][0]
  expect(request.url).toBe("http://localhost:3000/tanovo-time/api/auth/callback/microsoft-entra-id?code=fixture")
})

it("does not duplicate an already public authentication prefix", () => {
  GET(new NextRequest("http://localhost:3000/tanovo-time/api/auth/session"))
  expect(vi.mocked(handlers.GET).mock.calls[0][0].url).toBe("http://localhost:3000/tanovo-time/api/auth/session")
})

it("preserves the POST method and sign-in payload", async () => {
  POST(new NextRequest("http://localhost:3000/api/auth/signin/microsoft-entra-id", {
    method: "POST", headers: {"content-type":"application/x-www-form-urlencoded"}, body: "csrfToken=fixture",
  }))
  const request = vi.mocked(handlers.POST).mock.calls[0][0]
  expect(request.url).toContain("/tanovo-time/api/auth/signin/microsoft-entra-id")
  expect(request.method).toBe("POST")
  expect(await request.text()).toBe("csrfToken=fixture")
})

it("routes an explicitly tagged step-up sign-in to isolated handlers", async () => {
  POST(new NextRequest("http://localhost:3000/api/auth/signin/microsoft-entra-id?stepup=1", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "csrfToken=fixture",
  }))
  const request = vi.mocked(stepUpHandlers.POST).mock.calls[0][0]
  expect(request.url).toContain("/tanovo-time/api/auth/signin/microsoft-entra-id?stepup=1")
  expect(vi.mocked(handlers.POST)).not.toHaveBeenCalled()
})

it("routes the unchanged Entra callback URI to isolated handlers using its state cookie", () => {
  const log=vi.spyOn(console,"info").mockImplementation(()=>{})
  GET(new NextRequest("http://localhost:3000/api/auth/callback/microsoft-entra-id?code=fixture", {
    headers: { cookie: "tanovo-time.stepup.state=fixture" },
  }))
  expect(vi.mocked(stepUpHandlers.GET).mock.calls[0][0].url).toBe("http://localhost:3000/tanovo-time/api/auth/callback/microsoft-entra-id?code=fixture")
  expect(vi.mocked(handlers.GET)).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith("[auth-route] OAuth callback routed.",{
    flow:"step-up",
    hasStepUpStateCookie:true,
  })
  log.mockRestore()
})

it("reports a primary callback without exposing cookie values",()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>{})
  GET(new NextRequest("http://localhost:3000/api/auth/callback/microsoft-entra-id?code=fixture",{
    headers:{cookie:"unrelated=private-value"},
  }))
  expect(log).toHaveBeenCalledWith("[auth-route] OAuth callback routed.",{
    flow:"primary",
    hasStepUpStateCookie:false,
  })
  log.mockRestore()
})
