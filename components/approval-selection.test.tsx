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
it("rejects selected records only after an explicit reason and confirmation",async()=>{
  const request=vi.fn(async(_url:unknown,_init?:RequestInit)=>Response.json({entry:{...entry,status:"rejected"}}));vi.stubGlobal("fetch",request)
  render(<ApprovalSelection entries={[{...entry,revision:"original"}]} email="manager@example.com" canReview canAI onUpdated={()=>{}}/> )
  await userEvent.click(screen.getByRole("checkbox"));await userEvent.click(screen.getByRole("button",{name:"Review selected (1)"}))
  await userEvent.click(screen.getByRole("button",{name:"Return selected for correction"}))
  expect(screen.getByRole("button",{name:"Confirm 1 rejections"})).toBeDisabled()
  await userEvent.type(screen.getByLabelText("Selected rejection reason"),"Correct the hours")
  expect(request).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Confirm 1 rejections"}))
  await waitFor(()=>expect(request).toHaveBeenCalledOnce())
  expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toMatchObject({status:"rejected",reviewNote:"Correct the hours",expectedRevision:"original"})
})
it("does not silently replace the confirmed revision when evidence refreshes",async()=>{
  const request=vi.fn();vi.stubGlobal("fetch",request)
  const props={email:"manager@example.com",canReview:true,canAI:true,onUpdated:()=>{}}
  const {rerender}=render(<ApprovalSelection {...props} entries={[{...entry,revision:"original"}]}/> )
  await userEvent.click(screen.getByRole("checkbox"));await userEvent.click(screen.getByRole("button",{name:"Review selected (1)"}))
  rerender(<ApprovalSelection {...props} entries={[{...entry,revision:"changed",hours:9}]}/> )
  expect(screen.getByRole("button",{name:"Confirm 1 approvals"})).toBeDisabled()
  expect(screen.getByRole("alert")).toHaveTextContent("Evidence changed")
  expect(request).not.toHaveBeenCalled()
})
it("retains the rejection reason and reference after an unconfirmed save",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Save not confirmed",reference:"safe-reference"},{status:503})))
  render(<ApprovalSelection entries={[entry]} email="manager@example.com" canReview canAI onUpdated={()=>{}}/> )
  await userEvent.click(screen.getByRole("checkbox"));await userEvent.click(screen.getByRole("button",{name:"Review selected (1)"}));await userEvent.click(screen.getByRole("button",{name:"Return selected for correction"}))
  await userEvent.type(screen.getByLabelText("Selected rejection reason"),"Please correct")
  await userEvent.click(screen.getByRole("button",{name:"Confirm 1 rejections"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("safe-reference")
  expect(screen.getByLabelText("Selected rejection reason")).toHaveValue("Please correct")
})
it("does not offer approval without forwarding rights while leaving rejection available",async()=>{
  render(<ApprovalSelection entries={[{...entry,approvalEligible:false}]} email="manager@example.com" canReview canAI onUpdated={()=>{}}/> )
  await userEvent.click(screen.getByRole("checkbox"));await userEvent.click(screen.getByRole("button",{name:"Review selected (1)"}))
  expect(screen.getByRole("button",{name:"Confirm 1 approvals"})).toBeDisabled()
  await userEvent.click(screen.getByRole("button",{name:"Return selected for correction"}))
  await userEvent.type(screen.getByLabelText("Selected rejection reason"),"Needs correction")
  expect(screen.getByRole("button",{name:"Confirm 1 rejections"})).toBeEnabled()
})
