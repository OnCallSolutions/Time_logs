/**
 * Verifies a submitted timesheet waits for an eligible manager and preserves failures.
 * This protects the local and remote send path from reporting false success.
 * No authentication provider or database is used in this focused component test.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect,it,vi } from "vitest"
import { SubmissionActions } from "./submission-actions"
import type { TimeEntry } from "@/lib/types"
const entry:TimeEntry={id:"8c4fd4ed-a7a6-4c71-9a17-322187fb2c21",revision:"2026-10-16T00:00:00.000Z",contractor:"Test Contractor",date:"2026-10-15",hours:4,project:"Project A",description:"Work",status:"draft"}
it("submits a confirmed entry to the selected active reviewer",async()=>{
  const fetchMock=vi.fn(async()=>Response.json({managers:[{email:"manager@example.com",displayName:"Morgan Manager"}]}));vi.stubGlobal("fetch",fetchMock)
  const onStatusChange=vi.fn(async()=>{}),onSubmitted=vi.fn()
  render(<SubmissionActions entries={[entry]} destination="manager" onStatusChange={onStatusChange} onSubmitted={onSubmitted}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Submit selected (1)"}));await screen.findByRole("option",{name:"Morgan Manager"})
  await user.selectOptions(screen.getByLabelText("Reviewing manager"),"manager@example.com")
  await user.click(screen.getByRole("button",{name:"Confirm submission (1)"}))
  await waitFor(()=>expect(onStatusChange).toHaveBeenCalledWith(entry.id,"submitted",undefined,entry.revision,"manager@example.com"))
  expect(onSubmitted).toHaveBeenCalledWith(entry.id)
})
it("shows the server failure and keeps the entry available for correction",async()=>{
  const fetchMock=vi.fn(async()=>Response.json({managers:[{email:"manager@example.com",displayName:"Morgan Manager"}]}));vi.stubGlobal("fetch",fetchMock)
  const onStatusChange=vi.fn(async()=>{throw new Error("Reviewer rights are no longer active.")})
  render(<SubmissionActions entries={[entry]} destination="manager" onStatusChange={onStatusChange} onSubmitted={vi.fn()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Submit selected (1)"}));await screen.findByRole("option",{name:"Morgan Manager"})
  await user.selectOptions(screen.getByLabelText("Reviewing manager"),"manager@example.com");await user.click(screen.getByRole("button",{name:"Confirm submission (1)"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("Reviewer rights are no longer active.")
  expect(screen.getByText("Project A / 2026-10-15")).toBeInTheDocument()
})
it("explains when there is no active manager with the required review rights",async()=>{
  const fetchMock=vi.fn(async()=>Response.json({managers:[]}));vi.stubGlobal("fetch",fetchMock)
  render(<SubmissionActions entries={[entry]} destination="manager" onStatusChange={vi.fn()} onSubmitted={vi.fn()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Submit selected (1)"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("No active manager currently has both team-view and approval rights")
})
