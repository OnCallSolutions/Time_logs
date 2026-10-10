/**
 * Tests the AI review authorization boundary without making real model calls.
 * Recommendations must reference server-loaded entries and cannot mutate records.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/effective-permissions", () => ({ getEffectivePermissions: vi.fn() }))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db", () => ({ listTimeEntries: vi.fn() }))
vi.mock("ai", async importOriginal => ({...await importOriginal<typeof import("ai")>(),generateText:vi.fn(),Output:{object:vi.fn()}}))
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getEffectiveUserRole } from "@/lib/access"
import { resolvePermissions } from "@/lib/permissions"
import { listTimeEntries } from "@/lib/db"
import { generateText } from "ai"
import { POST } from "./route"
beforeEach(() => {vi.resetAllMocks();vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor")})
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
  vi.mocked(listTimeEntries).mockResolvedValue([{id:"known",ownerEmail:"person@example.com",status:"submitted"}] as never)
  vi.mocked(generateText).mockResolvedValue({output:{recommendations:[{entryId:"invented",decision:"approved",reason:"Looks fine"}]}} as never)
  expect((await POST()).status).toBe(503)
})
it("withholds advice when permissions are revoked during analysis",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValueOnce({role:"manager",permissions:resolvePermissions("manager")}).mockResolvedValueOnce({role:"manager",permissions:resolvePermissions("manager",{ai_review:false})})
  vi.mocked(listTimeEntries).mockResolvedValue([{id:"known",ownerEmail:"person@example.com",status:"submitted"}] as never)
  vi.mocked(generateText).mockResolvedValue({output:{recommendations:[{entryId:"known",decision:"needs_review",reason:"Check"}]}} as never)
  expect((await POST()).status).toBe(403)
})
it("loads each owner's effective role only once within a request",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"manager@example.com"}} as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(listTimeEntries).mockResolvedValue([{id:"one",ownerEmail:"person@example.com",status:"submitted"},{id:"two",ownerEmail:"person@example.com",status:"submitted"}] as never)
  vi.mocked(generateText).mockResolvedValue({output:{recommendations:[]}} as never)
  expect((await POST()).status).toBe(200);expect(getEffectiveUserRole).toHaveBeenCalledTimes(1)
})
