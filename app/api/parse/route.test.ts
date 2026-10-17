/**
 * Exercises multi-entry extraction without real model calls or persisted records.
 * Separate same-day/project tasks must survive output mapping and identity binding.
 * The model prompt explicitly forbids aggregation of independent work units.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({listAccountIdentities:vi.fn(async()=>[])}))
vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: vi.fn() }))
import { generateText } from "ai"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolvePermissions } from "@/lib/permissions"
import { POST } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "own@example.com", name: "Own Person" } } as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "contractor", permissions: resolvePermissions("contractor") })
})

it("preserves twelve distinct work units and binds every personal result to the session", async () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ contractor: "Untrusted Name", date: "2026-10-15", project: "Same Project", hours: 0.5, description: `Task ${index + 1}` }))
  vi.mocked(generateText).mockResolvedValue({ output: { entries } } as never)
  const response = await POST(new Request("http://localhost/api/parse", { method: "POST", body: JSON.stringify({ notes: entries.map(entry => entry.description).join("\n") }) }))
  const result = await response.json()
  expect(result.entries).toHaveLength(12)
  expect(result.entries.every((entry: { contractor: string }) => entry.contractor === "Own Person")).toBe(true)
  expect(new Set(result.entries.map((entry: { description: string }) => entry.description)).size).toBe(12)
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain("Never merge, deduplicate, sum, or truncate")
})

it("refuses to extract display-only manager sample IDs",async()=>{
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"Sample Contractor A (ID: SAMPLE-CTR-001): 2 hours"})}))
  expect(response.status).toBe(400)
  expect(generateText).not.toHaveBeenCalled()
})
