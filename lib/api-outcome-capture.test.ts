import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit", () => ({ getAuditContext: vi.fn(() => ({ ipAddress: null, userAgent: null, requestMethod: "POST", requestPath: "/api/entries", requestId: "req-123" })) }))
vi.mock("@/lib/operational-events", () => ({ recordOperationalEvent: vi.fn(), sanitizeOperationalMessage: (message: string) => message.replace(/person@example\.com/g, "[redacted email]") }))

import { auth } from "@/auth"
import { recordOperationalEvent } from "@/lib/operational-events"
import { withOperationalCapture } from "./api-outcome-capture"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "manager@example.com" } } as never)
})

it("captures denied API attempts with sanitized context without changing the response", async () => {
  const denied = Response.json({ error: "No access for person@example.com", code: "SCOPE_DENIED" }, { status: 403 })
  const handler = withOperationalCapture("/api/entries", "POST", async (_request:Request) => denied)
  const response = await handler(new Request("https://app.example/api/entries", { method: "POST" }))

  expect(response).toBe(denied)
  expect(await response.json()).toEqual({ error: "No access for person@example.com", code: "SCOPE_DENIED" })
  expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
    actorEmail: "manager@example.com",
    category: "authorization_denied",
    operation: "api.post.entries",
    route: "/api/entries",
    method: "POST",
    httpStatus: 403,
    errorCode: "SCOPE_DENIED",
    message: "No access for [redacted email]",
    requestId: "req-123",
  }))
})

it("does not record successful responses", async () => {
  const handler = withOperationalCapture("/api/projects", "GET", async (_request:Request) => Response.json({ projects: [] }))
  await handler(new Request("https://app.example/api/projects"))
  expect(recordOperationalEvent).not.toHaveBeenCalled()
})

