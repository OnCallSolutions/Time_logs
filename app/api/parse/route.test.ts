/**
 * Exercises multi-entry extraction without real model calls or persisted records.
 * Separate same-day/project tasks must survive output mapping and identity binding.
 * The model prompt explicitly forbids aggregation of independent work units.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest"
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
afterEach(() => vi.unstubAllEnvs())

it("preserves twelve distinct work units and binds every personal result to the session", async () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ contractor: "Own Person", date: "2026-10-15", project: "Same Project", hours: 0.5, description: `Task ${index + 1}`, evidenceQuote: `Task ${index + 1}`, reviewFlags: [] }))
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

it("keeps a concrete meeting decision when hours and date are missing",async()=>{
  const notes="We agreed to use a phone demo to train the new sales group."
  vi.mocked(generateText).mockResolvedValue({output:{entries:[{contractor:null,date:null,hours:null,project:"Unassigned",description:"Agreed to use a phone demo to train the sales group.",evidenceQuote:"We agreed to use a phone demo to train the new sales group.",reviewFlags:[]}]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes,periodId:"10000000-0000-4000-8000-000000000001"})}))
  const result=await response.json()
  expect(response.status).toBe(200)
  expect(result.entries[0]).toMatchObject({date:null,hours:null,project:"Unassigned",evidenceQuote:notes})
  expect(result.entries[0].reviewFlags).toEqual(expect.arrayContaining(["date_needs_confirmation","hours_needs_confirmation","project_needs_confirmation"]))
  expect(result.entries[0].contractor).toBe("Own Person")
  const prompt=vi.mocked(generateText).mock.calls[0][0].system
  expect(prompt).toContain("specific review, decision, assignment, coaching action, or coordination step")
  expect(prompt).toContain("Do not require every field to be known before returning a supported work row")
})

it("grounds transcript drafts in concrete actions and leaves missing fields for confirmation",async()=>{
  const notes = [
    "Own Person: I enabled transcription so we can test timesheet extraction.",
    "Speaker B: Will it identify who is speaking?",
    "Own Person: Someone might say they worked on XYZ, and the app could suggest 8 hours."
  ].join("\n")
  vi.mocked(generateText).mockResolvedValue({output:{entries:[{
    contractor:"Own Person",date:null,hours:null,project:"Unassigned",
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
  expect(prompt).toContain("This is a personal timesheet for Own Person")
  expect(prompt).toContain("Omit all rows from other speakers")
  expect(prompt).toContain("hypotheticals")
  expect(prompt).toContain("Never apply a default 8-hour day")
  expect(prompt).toContain("the action, the thing worked on, and the stated outcome or purpose")
  expect(vi.mocked(generateText).mock.calls[0][0].prompt).toContain("<source_notes>")
})

it("uses official patron names and filters work attributed to other speakers",async()=>{
  const {listAccountIdentities}=await import("@/lib/account-identities")
  vi.mocked(listAccountIdentities).mockResolvedValue([{email:"own@example.com",officialName:"Franco Abott",contractorNumber:"TN-1"}] as never)
  const notes="Other Person: I completed the inventory.\nFranco Abott\n0 minutes 12 seconds0:12\nI spent 2 hours checking the project records."
  vi.mocked(generateText).mockResolvedValue({output:{entries:[
    {contractor:"Other Person",date:"2026-10-12",hours:1,project:"Project",description:"Completed inventory",evidenceQuote:"I completed the inventory.",reviewFlags:[]},
    {contractor:"Franco Abott",date:"2026-10-12",hours:2,project:"Project",description:"Checked project records",evidenceQuote:"I spent 2 hours checking the project records.",reviewFlags:[]},
  ]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes,periodId:"10000000-0000-4000-8000-000000000001"})}))
  const result=await response.json()
  expect(response.status).toBe(200)
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0]).toMatchObject({contractor:"Franco Abott",hours:2})
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain('"franco abott"')
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
  vi.mocked(checkApiRateLimit).mockResolvedValue({allowed:false,hits:61})
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"Work",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(429)
  expect(response.headers.get("retry-after")).toBe("60")
  expect(checkApiRateLimit).toHaveBeenCalledWith("own@example.com","timesheet-extraction",60,expect.any(Request))
  expect(generateText).not.toHaveBeenCalled()
})

it("returns an actionable setup message when Gateway inference is blocked by account access",async()=>{
  vi.mocked(generateText).mockRejectedValue(Object.assign(new Error("Gateway request failed"),{
    cause:{error:{type:"no_providers_available",name:"RestrictedModelsError",message:"Free tier users do not have access to this model."}},
  }))
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"I worked 2 hours on a task.",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({code:"AI_PROVIDER_ACCESS_REQUIRED",error:expect.stringContaining("Enable Gateway credits")})
})

it("returns a clear setup response when direct OpenAI is selected without its server key",async()=>{
  vi.stubEnv("AI_PROVIDER","openai")
  vi.stubEnv("OPENAI_API_KEY","")
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"I worked 2 hours on a task.",periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({code:"OPENAI_API_KEY_REQUIRED",error:expect.stringContaining("OPENAI_API_KEY")})
  expect(generateText).not.toHaveBeenCalled()
})

it("sends extraction directly to OpenAI when explicitly selected and does not enable Gateway fallback",async()=>{
  vi.stubEnv("AI_PROVIDER","openai")
  vi.stubEnv("OPENAI_API_KEY","test-only-secret")
  vi.mocked(generateText).mockResolvedValue({output:{entries:[]}} as never)
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"Work completed.",periodId:"10000000-0000-4000-8000-000000000001"})}))
  const call=vi.mocked(generateText).mock.calls[0][0]
  expect(response.status).toBe(200)
  expect(call.model).toMatchObject({provider:"openai.responses",modelId:"gpt-6.1-sol"})
  expect(call.providerOptions).toBeUndefined()
})

it("rejects oversized streamed JSON even without a Content-Length header",async()=>{
  const response=await POST(new Request("http://localhost/api/parse",{method:"POST",body:JSON.stringify({notes:"x".repeat(70_000),periodId:"10000000-0000-4000-8000-000000000001"})}))
  expect(response.status).toBe(413)
  expect(generateText).not.toHaveBeenCalled()
})
