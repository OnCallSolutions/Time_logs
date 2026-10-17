/**
 * Inspects production review SQL with synthetic parameters and isolated storage.
 * Approval/handoff and rejection/audit must each remain one atomic statement.
 * These structural checks do not replace a live PostgreSQL concurrency test.
 */
import {beforeEach,expect,it,vi} from "vitest"
const {queries}=vi.hoisted(()=>{
  process.env.DATABASE_URL??="postgresql://unused:unused@localhost/unused"
  return{queries:[] as {text:string;values:unknown[]}[]}
})
vi.mock("@neondatabase/serverless",()=>({neon:()=>async(strings:TemplateStringsArray,...values:unknown[])=>{
  queries.push({text:strings.reduce((text,part,index)=>text+part+(index<values.length?`$${index+1}`:""),""),values});return[]
}}))
import {approveAndForward} from "./account-handoffs"
import {rejectSubmittedEntry} from "./db"
const id="00000000-0000-4000-8000-000000000000",actor="reviewer@example.invalid",revision="2000-01-01T00:00:00Z",context={ipAddress:null,userAgent:null}
beforeEach(()=>{queries.length=0})
it("binds approval, business handoff and audit to unchanged independently owned submitted evidence",async()=>{
  expect(await approveAndForward(id,actor,revision,"contractor",context)).toBeNull()
  const decision=queries.find(query=>query.text.includes("WITH changed AS"))!
  expect(decision.text).toContain("INSERT INTO account_handoffs")
  expect(decision.text).toContain("INSERT INTO audit_events")
  expect(decision.text).toContain("status='submitted'")
  expect(decision.text).toMatch(/updated_at=\$\d+::timestamptz/)
  expect(decision.text).toContain("payout_eligible_at IS NULL")
  expect(decision.values).toContain(revision)
})
it("rejects atomically with its audit and never persists the human reason in audit metadata",async()=>{
  expect(await rejectSubmittedEntry(id,actor,revision,"Private reason",context)).toBeNull()
  const decision=queries.find(query=>query.text.includes("WITH changed AS"))!
  expect(decision.text).toContain("INSERT INTO audit_events")
  expect(decision.text).toContain("status='submitted'")
  expect(decision.text).toContain("lower(owner_email)<>")
  expect(decision.values.filter(value=>value==="Private reason")).toHaveLength(1)
  expect(decision.values).toContain(revision)
})
