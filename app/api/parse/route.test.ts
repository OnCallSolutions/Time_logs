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
vi.mock("@/lib/db",()=>({listTimeProjects:vi.fn(async()=>[]),listTimesheetPeriods:vi.fn()}))
vi.mock("@/lib/api-rate-limit",()=>({checkApiRateLimit:vi.fn(async()=>({allowed:true,hits:1}))}))
import { generateText } from "ai"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { checkApiRateLimit } from "@/lib/api-rate-limit"
import { listTimeProjects, listTimesheetPeriods } from "@/lib/db"
import { resolvePermissions } from "@/lib/permissions"
import { POST } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "own@example.com", name: "Own Person" } } as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({ role: "contractor", permissions: resolvePermissions("contractor") })
  vi.mocked(listTimesheetPeriods).mockResolvedValue([{id:"10000000-0000-4000-8000-000000000001",name:"October 2026",startDate:"2026-10-01",endDate:"2026-10-31"}] as never)
})

it("preserves twelve distinct work units and binds every personal result to the session", async () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ contractor: "Untrusted Name", date: "2026-10-15", project: "Same Project", hours: 0.5, description: `Task ${index + 1}`, evidenceQuote: `Task ${index + 1}`, reviewFlags: [] }))
  vi.mocked(generateText).mockResolvedValue({ output: { entries } } as never)
  const response = await POST(new Request("http://localhost/api/parse", { method: "POST", body: JSON.stringify({ notes: entries.map(entry => entry.description).join("\n"),periodId:"10000000-0000-4000-8000-000000000001" }) }))
  const result = await response.json()
  expect(result.entries).toHaveLength(12)
  expect(result.entries.every((entry: { contractor: string }) => entry.contractor === "Own Person")).toBe(true)
  expect(new Set(result.entries.map((entry: { description: string }) => entry.description)).size).toBe(12)
  expect(vi.mocked(generateText).mock.calls[0][0].model).toBe("openai/gpt-6.1-sol")
  expect(vi.mocked(generateText).mock.calls[0][0].providerOptions).toEqual({ gateway: { models: ["openai/gpt-5.6-sol"] } })
  expect(vi.mocked(generateText).mock.calls[0][0].reasoning).toBe("high")
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain("never merge, deduplicate, sum, or truncate")
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain("2026-10-01 through 2026-10-31")
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain("verbatim contiguous evidenceQuote")
  expect(vi.mocked(generateText).mock.calls[0][0].maxRetries).toBe(0)
  expect(vi.mocked(generateText).mock.calls[0][0].maxOutputTokens).toBe(8000)
})

it("refuses to extract display-only manager sample IDs",async()=>{
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"Sample Contractor A (ID: SAMPLE-CTR-001): 2 hours"})}))
  expect(response.status).toBe(400)
  expect(generateText).not.toHaveBeenCalled()
})

it("rejects AI dates outside the selected configured period before they can be saved",async()=>{
  vi.mocked(generateText).mockResolvedValue({output:{entries:[{contractor:"Own Person",date:"2026-11-01",hours:2,project:"Project",description:"Work",evidenceQuote:"Work",reviewFlags:[]}]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"2 hours on October 31",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(422)
  expect(generateText).toHaveBeenCalledOnce()
})

it("leaves unsupported fields blank and flags evidence not found in the source notes",async()=>{
  vi.mocked(generateText).mockResolvedValue({output:{entries:[{contractor:null,date:null,hours:null,project:"Unassigned",description:"Work item",evidenceQuote:"invented source text",reviewFlags:[]}]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"The team discussed a possible task.",periodId:"10000000-0000-4000-8000-000000000001"})}))
  const result=await response.json()
  expect(response.status).toBe(200)
  expect(result.entries[0]).toMatchObject({date:null,hours:null,project:"Unassigned",evidenceQuote:null})
  expect(result.entries[0].reviewFlags).toEqual(expect.arrayContaining(["date_needs_confirmation","hours_needs_confirmation","project_needs_confirmation","evidence_unverified"]))
  expect(result.entries[0].contractor).toBe("Own Person")
})

it("grounds transcript drafts in concrete actions and leaves missing fields for confirmation",async()=>{
  const notes = [
    "Speaker A: I enabled transcription so we can test timesheet extraction.",
    "Speaker B: Will it identify who is speaking?",
    "Speaker A: Someone might say they worked on XYZ, and the app could suggest 8 hours."
  ].join("\n")
  vi.mocked(generateText).mockResolvedValue({output:{entries:[{
    contractor:"Speaker A",date:null,hours:null,project:"Unassigned",
    description:"Enabled transcription for a timesheet extraction test.",
    evidenceQuote:"I enabled transcription so we can test timesheet extraction.",
    reviewFlags:["date_needs_confirmation","hours_needs_confirmation","project_needs_confirmation"]
  }]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes,periodId:"10000000-0000-4000-8000-000000000001"})}))
  const result=await response.json()
  const prompt=vi.mocked(generateText).mock.calls[0][0].system
  expect(response.status).toBe(200)
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0]).toMatchObject({contractor:"Own Person",date:null,hours:null,project:"Unassigned",evidenceQuote:"I enabled transcription so we can test timesheet extraction."})
  expect(result.entries[0].reviewFlags).toEqual(expect.arrayContaining(["date_needs_confirmation","hours_needs_confirmation","project_needs_confirmation"]))
  expect(prompt).toContain("display name is not proof of an account identity")
  expect(prompt).toContain("hypothetical examples")
  expect(prompt).toContain("Never apply a suggested or default 8-hour day")
})

it("supplies only the contractor's assigned projects as canonical extraction hints",async()=>{
  vi.mocked(listTimeProjects).mockResolvedValue([{name:"Field service"}] as never)
  const entries=[{contractor:"Person",date:"2026-10-15",hours:2,project:"Field service",description:"Inspection",evidenceQuote:"Inspection",reviewFlags:[]}]
  vi.mocked(generateText).mockResolvedValue({output:{entries}} as never)
  await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"2h inspection for field service",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(listTimeProjects).toHaveBeenCalledWith(false,"own@example.com")
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain("Field service")
})

it("throttles extraction requests and provides a retry delay",async()=>{
  vi.mocked(checkApiRateLimit).mockResolvedValue({allowed:false,hits:6})
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"Work",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(429)
  expect(response.headers.get("retry-after")).toBe("60")
  expect(generateText).not.toHaveBeenCalled()
})

it("rejects oversized streamed JSON even without a Content-Length header",async()=>{
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"x".repeat(20_000),periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(413)
  expect(generateText).not.toHaveBeenCalled()
})
