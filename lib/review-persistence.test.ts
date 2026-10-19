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
import {createTimesheetExtensionRequest,decideTimesheetExtensionRequest,rejectSubmittedEntry,submitTimeEntryWithAudit,updateTimeEntryWithAudit} from "./db"
const id="00000000-0000-4000-8000-000000000000",actor="reviewer@example.invalid",revision="2000-01-01T00:00:00Z",context={ipAddress:null,userAgent:null,requestMethod:"PATCH",requestPath:"/api/entries/test",requestId:null}
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
  expect(decision.text).toContain("INSERT INTO entry_rejection_archive")
  expect(decision.text).toContain("INSERT INTO audit_events")
  expect(decision.text).toContain("jsonb_build_object('fromStatus','submitted','toStatus','rejected')")
  expect(decision.text).toContain("status='submitted'")
  expect(decision.text).toContain("lower(owner_email)<>")
  expect(decision.values.filter(value=>value==="Private reason")).toHaveLength(1)
  expect(decision.values).toContain(revision)
})
it("persists the assigned manager and explicitly types reviewer parameters in submission SQL",async()=>{
  await submitTimeEntryWithAudit("owner@example.invalid",id,{status:"submitted",reviewManagerEmail:"manager@example.invalid"},false,undefined,revision,actor,"draft",{changedFields:[]},"contractor",context)
  const submission=queries.find(query=>query.text.includes("'entry_submitted'"))!
  expect(submission.text).toMatch(/review_manager_email = \$\d+::text/)
  expect(submission.values).toContain("manager@example.invalid")
  expect(submission.text).toMatch(/status = 'submitted' AND \$\d+::text IS NOT NULL/)
  expect(submission.text).toMatch(/'fromStatus',\s*\$\d+::text/)
  expect(submission.text).toMatch(/\$\d+::text = 'manager'/)
  expect(submission.text).toMatch(/'hasReviewNote',\s*\$\d+::boolean/)
  expect(submission.text).toMatch(/\$19::text,\s*\$20::text,\s*\$21::text,\s*\$22::text,\s*\$23::text/)
  expect(submission.text).toContain("timesheet_extension_requests")
  expect(submission.text).toContain("x.approved_until>=now()")
  expect(submission.text).toContain("lower(x.requester_email)=lower(time_entries.owner_email)")
  expect(submission.text).toContain("lower(time_entries.correction_owner_email)=lower(")
  expect(submission.text).toContain("time_entries.correction_due_at>=now()")
})
it("types an omitted reviewer parameter in the audited status-update guard",async()=>{
  await updateTimeEntryWithAudit("owner@example.invalid",id,{status:"approved"},false,undefined,revision,{actorEmail:actor,action:"entry_approved",metadata:{},context})
  const update=queries.find(query=>query.text.includes("WITH changed AS")&&query.text.includes("UPDATE time_entries"))!
  expect(update.text).toMatch(/status='submitted' AND lower\(owner_email\)<>lower\(\$\d+\) AND \$\d+::text IS NOT NULL/)
})
it("bounds extension requests and approval grants by the account-manager-configured grace window",async()=>{
  await createTimesheetExtensionRequest({ownerEmail:"owner@example.invalid",periodId:id,assignedTo:actor,reason:"A documented delay",requestedUntil:"2099-01-01T00:00:00.000Z",notBeforeUntil:"2098-12-31T00:00:00.000Z",hardCapUntil:"2099-01-02T00:00:00.000Z"},context)
  await decideTimesheetExtensionRequest(id,actor,"approved","Approved for documented delay.","2099-01-01T00:00:00.000Z",false,context)
  const statements=queries.map(query=>query.text)
  const create=queries.find(query=>query.text.includes("INSERT INTO timesheet_extension_requests"))!
  const approve=queries.find(query=>query.text.includes("UPDATE timesheet_extension_requests"))!
  expect(create.text).toContain("requested_until,not_before_until,hard_cap_until")
  expect(create.text).toMatch(/\$\d+::timestamptz<=\$\d+::timestamptz/)
  expect(approve.text).toContain("COALESCE(r.hard_cap_until,p.manager_submission_deadline)")
  expect(approve.text).toContain("COALESCE(r.not_before_until,p.submission_deadline)")
  expect(approve.text).toContain("r.requested_until")
  expect(statements.some(statement=>statement.includes("INSERT INTO audit_events"))).toBe(true)
})
