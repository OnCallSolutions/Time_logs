import { beforeEach, expect, it, vi } from "vitest"
import { callIntegrationApi, IntegrationApiError } from "./http"

beforeEach(() => vi.restoreAllMocks())

it("sends Microsoft Graph calls only to its fixed origin with a supplied server token", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ value: [] }))
  await expect(callIntegrationApi({ provider: "microsoft_graph", operation: "calendar.list", method: "GET", path: "/me/events", accessToken: "server-token", query: { "$top": 5 } })).resolves.toEqual({ value: [] })
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ href: "https://graph.microsoft.com/v1.0/me/events?%24top=5" }), expect.objectContaining({ method: "GET", redirect: "error", headers: expect.objectContaining({ Authorization: "Bearer server-token" }) }))
})

it("rejects absolute, traversal, query-string, and body-bearing GET paths before making a request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch")
  const base = { provider: "microsoft_graph" as const, operation: "users.lookup", method: "GET" as const, accessToken: "token" }
  await expect(callIntegrationApi({ ...base, path: "https://attacker.example/collect" })).rejects.toThrow(/relative API paths/)
  await expect(callIntegrationApi({ ...base, path: "/me/../users" })).rejects.toThrow(/relative API paths/)
  await expect(callIntegrationApi({ ...base, path: "/me?select=mail" })).rejects.toThrow(/relative API paths/)
  await expect(callIntegrationApi({ ...base, path: "/me", body: { mail: "x" } })).rejects.toThrow(/cannot include a request body/)
  expect(fetch).not.toHaveBeenCalled()
})

it("returns sanitized upstream status, code, and request id without exposing response text", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "Authorization_RequestDenied", message: "private response" } }), { status: 403, headers: { "request-id": "req-123" } }))
  const result = callIntegrationApi({ provider: "microsoft_graph", operation: "users.read", method: "GET", path: "/users", accessToken: "token" })
  await expect(result).rejects.toMatchObject({ diagnostic: { status: 403, code: "Authorization_RequestDenied", requestId: "req-123", path: "/users" } })
  await expect(result).rejects.not.toThrow(/private response|token/)
})

it("uses a generic sanitized code when the upstream response has no safe code", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "Bad code!", message: "secret" } }), { status: 429 }))
  await expect(callIntegrationApi({ provider: "microsoft_graph", operation: "groups.list", method: "GET", path: "/groups", accessToken: "token" })).rejects.toMatchObject({ diagnostic: { status: 429, code: "HTTP_429", requestId: null } })
})

it("does not retry failed mutations and reports safe network diagnostics", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "GeneralException", message: "private" } }), { status: 503 }))
  await expect(callIntegrationApi({ provider: "microsoft_graph", operation: "calendar.create", method: "POST", path: "/me/events", accessToken: "token", body: { subject: "example" } })).rejects.toBeInstanceOf(IntegrationApiError)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it("reads bounded Graph transcript text without parsing it as JSON", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Person>Hello</v>", { headers: { "content-type": "text/vtt" } }))
  await expect(callIntegrationApi({ provider: "microsoft_graph", operation: "transcript.content", method: "GET", path: "/users/u/transcripts/t/content", accessToken: "token", accept: "text/vtt", responseType: "text" })).resolves.toContain("WEBVTT")
  expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ Accept: "text/vtt" }) }))
})

it("rejects oversized transcript responses", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("12345"))
  await expect(callIntegrationApi({ provider: "microsoft_graph", operation: "transcript.content", method: "GET", path: "/users/u/transcripts/t/content", accessToken: "token", responseType: "text", maxResponseBytes: 4 })).rejects.toMatchObject({ diagnostic: { status: 413, code: "RESPONSE_TOO_LARGE" } })
})
