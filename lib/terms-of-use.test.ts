import {beforeEach,expect,it,vi} from "vitest"
const {queries,accepted}=vi.hoisted(()=>({queries:[] as {text:string;values:unknown[]}[],accepted:{rows:[] as Record<string,unknown>[]}}))
process.env.DATABASE_URL??="postgresql://unused:unused@localhost/unused"
vi.mock("server-only",()=>({}))
vi.mock("@/lib/db",()=>({recordAuditEvent:vi.fn()}))
vi.mock("@neondatabase/serverless",()=>({neon:()=>async(strings:TemplateStringsArray,...values:unknown[])=>{
  const text=strings.join("?")
  queries.push({text,values})
  return text.includes("SELECT 1 FROM terms_acceptances")?accepted.rows:[]
}}))
import {hasAcceptedCurrentTerms} from "./terms-of-use"

beforeEach(()=>{queries.length=0;accepted.rows=[{accepted:1}]})

it("recognizes an existing account acceptance even after the terms version changes",async()=>{
  expect(await hasAcceptedCurrentTerms("Patron@Example.com")).toBe(true)
  const lookup=queries.find(query=>query.text.includes("SELECT 1 FROM terms_acceptances"))!
  expect(lookup.values).toEqual(["patron@example.com"])
  expect(lookup.text).not.toContain("version")
})

it("requires acceptance when the account has no prior acknowledgement",async()=>{
  accepted.rows=[]
  expect(await hasAcceptedCurrentTerms("new@example.com")).toBe(false)
})
