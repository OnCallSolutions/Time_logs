/**
 * Tests explicit selected approval confirmation and independent reviewer UI.
 * Server requests use synthetic records and do not mutate live timesheets.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { ApprovalSelection } from "./approval-selection"
import type { TimeEntry } from "@/lib/types"
const entry:TimeEntry={id:"123e4567-e89b-42d3-a456-426614174000",ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-09",hours:4,project:"Project",description:"Work",status:"submitted"}
afterEach(()=>vi.unstubAllGlobals())
it("excludes the current manager's records from selection",()=>{
  render(<ApprovalSelection entries={[entry,{...entry,id:"own",ownerEmail:"manager@example.com",contractor:"Manager"}]} email="manager@example.com" canReview canAI onUpdated={()=>{}}/>)
  expect(screen.getByRole("checkbox",{name:"Select Supplier 2026-10-09"})).toBeVisible()
  expect(screen.queryByRole("checkbox",{name:"Select Manager 2026-10-09"})).not.toBeInTheDocument()
})
it("does not approve selected records until the confirmation command",async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({entry:{...entry,status:"approved"}})))
  vi.stubGlobal("fetch",request);const updated=vi.fn()
  render(<ApprovalSelection entries={[entry]} email="manager@example.com" canReview canAI onUpdated={updated}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("checkbox"))
  await user.click(screen.getByRole("button",{name:"Review selected (1)"}))
  expect(request).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button",{name:"Confirm 1 approvals"}))
  await waitFor(()=>expect(updated).toHaveBeenCalledWith(expect.objectContaining({status:"approved"})))
})
it("selects only visible eligible rows after searching",async()=>{
  render(<ApprovalSelection entries={[entry,{...entry,id:"other",contractor:"Other supplier"}]} email="manager@example.com" canReview canAI onUpdated={()=>{}}/>);const user=userEvent.setup()
  await user.type(screen.getByRole("textbox",{name:"Search review queue"}),"Other")
  expect(screen.queryByRole("checkbox",{name:"Select Supplier 2026-10-09"})).not.toBeInTheDocument()
  await user.click(screen.getByRole("button",{name:"Select all eligible (up to 50)"}))
  expect(screen.getByRole("button",{name:"Review selected (1)"})).toBeEnabled()
})
