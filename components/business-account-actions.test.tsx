import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { BusinessAccountActions } from "./business-account-actions"

afterEach(() => vi.unstubAllGlobals())

const row = {
  id: "123e4567-e89b-42d3-a456-426614174000", entry_id: "123e4567-e89b-42d3-a456-426614174001",
  assigned_to: "accounts@example.com", handed_by: "manager@example.com", created_at: "2026-10-10T12:00:00Z",
  source_updated_at: "2026-10-10T12:00:00Z",
  current: true, review_state: "pending" as const, review_note: "", review_version: 4,
  evidence: { contractor: "Casey", ownerEmail: "casey@example.com", workerCategory: "contractor" as const, date: "2026-10-10", hours: 4, project: "Build", description: "Work", reviewedBy: "manager@example.com", reviewedAt: "2026-10-10T12:00:00Z" },
}
const periods=[{id:"period",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}]

it("requires a destination and reason, then sends selected revision-bound handoffs", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: 1 })))
  const onComplete = vi.fn()
  vi.stubGlobal("fetch", fetch)
  render(<BusinessAccountActions rows={[row]} managers={[{ email: "lead@example.com" }]} periods={periods} canAuthorize={false} onComplete={onComplete} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Actions (1)" }))
  const confirm = screen.getByRole("button", { name: "Confirm 1 timesheets" })
  expect(confirm).toBeDisabled()
  await user.selectOptions(screen.getByRole("combobox", { name: "Receiving manager" }), "lead@example.com")
  await user.type(screen.getByRole("textbox", { name: "Reason / review note" }), "Please correct the project details")
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/accounts"), expect.objectContaining({method:"PATCH"}))
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({action:"return_manager",selection:[{id:row.id,version:4}],note:"Please correct the project details",checks:{accuracy:false,compliance:false,housekeeping:false},manager:"lead@example.com",correctionDueAt:periods[0].exceptionResolutionDeadline})
})

it("gates eligibility on permission and every human review check", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  render(<BusinessAccountActions rows={[row]} managers={[]} periods={periods} canAuthorize onComplete={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Actions (1)" }))
  await user.click(screen.getByRole("button", { name: "Authorize payout eligibility" }))
  const confirm = screen.getByRole("button", { name: "Authorize 1 timesheets" })
  await user.type(screen.getByRole("textbox", { name: "Reason / review note" }), "Eligibility review complete")
  expect(confirm).toBeDisabled()
  await user.click(screen.getByRole("checkbox", { name: "Accuracy checked" }))
  await user.click(screen.getByRole("checkbox", { name: "Compliance checked" }))
  expect(confirm).toBeDisabled()
  await user.click(screen.getByRole("checkbox", { name: "Internal housekeeping complete" }))
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({ action: "authorize_eligibility", selection: [{ id: row.id, version: 4 }], checks: { accuracy: true, compliance: true, housekeeping: true } })
})

it("records account-manager approval as a separate batch decision",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({count:1})))
  vi.stubGlobal("fetch",fetch)
  render(<BusinessAccountActions rows={[row]} managers={[]} periods={periods} canAuthorize={false} onComplete={vi.fn()}/>);
  const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Actions (1)"}))
  await user.click(screen.getByRole("button",{name:"Approve timesheets"}))
  await user.type(screen.getByRole("textbox",{name:"Reason / review note"}),"Final account review complete")
  const confirm=screen.getByRole("button",{name:"Approve 1 timesheets"})
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({action:"approve_timesheets",selection:[{id:row.id,version:4}],note:"Final account review complete"})
})

it("makes recalled batches an explicit audited override-and-approve decision",async()=>{
  const recalled={...row,review_state:"reopened_for_review" as const}
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({count:1})))
  vi.stubGlobal("fetch",fetch)
  render(<BusinessAccountActions rows={[recalled]} managers={[]} periods={periods} canAuthorize={false} onComplete={vi.fn()}/>);
  const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Actions (1)"}))
  await user.click(screen.getByRole("button",{name:"Override & approve"}))
  await user.type(screen.getByRole("textbox",{name:"Approval / override reason"}),"Reviewed the concern and verified source records")
  await user.click(screen.getByRole("button",{name:"Override & approve 1 timesheets"}))
  await waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({action:"approve_timesheets",note:"Reviewed the concern and verified source records"})
})

it("requires one rejected entry and sends every entry in the selected timesheet", async () => {
  const second={...row,id:"123e4567-e89b-42d3-a456-426614174002",entry_id:"123e4567-e89b-42d3-a456-426614174003",evidence:{...row.evidence,project:"Review"}}
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({count:2})))
  vi.stubGlobal("fetch",fetch)
  render(<BusinessAccountActions rows={[row,second]} managers={[]} periods={periods} canAuthorize={false} onComplete={vi.fn()}/>)
  const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Actions (2)"}))
  await user.click(screen.getByRole("button",{name:"To submitter"}))
  const confirm=screen.getByRole("button",{name:"Confirm 1 timesheets"})
  await user.type(screen.getByRole("textbox",{name:"Reason / review note"}),"Correct this entry")
  expect(confirm).toBeDisabled()
  await user.click(screen.getByRole("radio",{name:`Flag ${row.evidence.project} ${row.evidence.date} as rejected`}))
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await waitFor(()=>expect(fetch).toHaveBeenCalledOnce())
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).selection).toEqual([{id:row.id,version:4,reject:true},{id:second.id,version:4,reject:false}])
})
