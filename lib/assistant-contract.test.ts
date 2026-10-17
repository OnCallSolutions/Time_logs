/**
 * Verifies the assistant only offers actions allowed by current server permissions.
 * Schemas reject arbitrary properties, oversized work and executable payloads.
 * The tests do not call an AI provider or application database.
 */
import { expect, it } from "vitest"
import { assistantActionSchema, assistantResponseSchema, canOfferAction } from "./assistant-contract"
import { resolvePermissions } from "./permissions"
it("rejects arbitrary code and extra action fields",()=>{
  expect(assistantActionSchema.safeParse({kind:"navigate",destination:"https://evil.invalid",script:"alert(1)"}).success).toBe(false)
  expect(assistantResponseSchema.safeParse({answer:"Hi",actions:[],html:"<script>"}).success).toBe(false)
})
it("limits proposed entry batches and rejects invalid hours",()=>{
  const entry={contractor:"Ignored identity",date:"2026-10-16",hours:25,project:"P",description:""}
  expect(assistantActionSchema.safeParse({kind:"create_entries",entries:[entry]}).success).toBe(false)
  expect(assistantActionSchema.safeParse({kind:"create_entries",entries:Array.from({length:31},(_,index)=>({...entry,hours:1,description:String(index)}))}).success).toBe(false)
})
it("uses live role rights to filter navigation and mutation proposals",()=>{
  const employee={role:"employee" as const,permissions:resolvePermissions("employee")}
  expect(canOfferAction({kind:"navigate",destination:"admin"},employee)).toBe(false)
  expect(canOfferAction({kind:"navigate",destination:"log"},employee)).toBe(true)
  expect(canOfferAction({kind:"compose_message",recipient:"manager@example.com",body:"Hi"},employee)).toBe(false)
  const manager={role:"manager" as const,permissions:resolvePermissions("manager")}
  expect(canOfferAction({kind:"compose_message",recipient:"employee@example.com",body:"Hi"},manager)).toBe(true)
})
