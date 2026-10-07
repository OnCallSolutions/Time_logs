/**
 * Tests the AI review authorization boundary without making real model calls.
 * Recommendations must reference server-loaded entries and cannot mutate records.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: vi.fn() }))
vi.mock("@/lib/db", () => ({ listTimeEntries: vi.fn() }))
vi.mock("ai", () => ({ generateText: vi.fn(), Output: {object:vi.fn()} }))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolvePermissions } from "@/lib/permissions"
import { listTimeEntries } from "@/lib/db"
import { generateText } from "ai"
import { POST } from "./route"
beforeEach(() => vi.resetAllMocks())
it("denies employee access before loading team records or invoking AI", async () => {
  vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"employee",permissions:resolvePermissions("employee")})
  expect((await POST()).status).toBe(403)
  expect(listTimeEntries).not.toHaveBeenCalled()
  expect(generateText).not.toHaveBeenCalled()
})
it("rejects invented AI references", async () => {
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(listTimeEntries).mockResolvedValue([{id:"known",status:"submitted"}] as never)
  vi.mocked(generateText).mockResolvedValue({output:{recommendations:[{entryId:"invented",decision:"approved",reason:"Looks fine"}]}} as never)
  expect((await POST()).status).toBe(503)
})
