import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { ApprovalSelection } from "./approval-selection"
import type { TimeEntry } from "@/lib/types"

const first:TimeEntry={id:"123e4567-e89b-42d3-a456-426614174000",ownerEmail:"supplier@example.com",contractor:"Supplier",date:"2026-10-09",hours:4,project:"Project",description:"Work",status:"submitted",revision:"first-revision"}
const second:TimeEntry={...first,id:"223e4567-e89b-42d3-a456-426614174000",date:"2026-10-10",hours:2,project:"Project B",description:"More work",revision:"second-revision"}
const props={email:"manager@example.com",canReview:true,canAI:false,onUpdated:vi.fn()}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();sessionStorage.clear()})

it("groups submitted entries into a complete person-period timesheet",()=>{
  render(<ApprovalSelection entries={[first,second,{...first,id:"323e4567-e89b-42d3-a456-426614174000",ownerEmail:"manager@example.com",contractor:"Manager"}]} {...props}/> )
  expect(screen.getByRole("checkbox",{name:/Select timesheet Supplier/})).toBeVisible()
  expect(screen.queryByRole("checkbox",{name:/Select timesheet Manager/})).not.toBeInTheDocument()
  expect(screen.getByText(/1 timesheet visible · 1 awaiting · 0 selected \(0 entries\)/)).toBeVisible()
})

it("approves every submitted entry in the selected timesheet",async()=>{
  const updated=vi.fn()
  const request=vi.fn(async(url:unknown,init?:RequestInit)=>String(url).includes("timesheet-periods")?Response.json({periods:[]}):Response.json({entries:[{...first,status:"approved"},{...second,status:"approved"}]}))
  vi.stubGlobal("fetch",request)
  render(<ApprovalSelection entries={[first,second]} {...props} onUpdated={updated}/> )
  const user=userEvent.setup()
  await user.click(screen.getByRole("checkbox",{name:/Select timesheet Supplier/}))
  await user.click(screen.getByRole("button",{name:"Review 1 timesheet"}))
  expect(request.mock.calls.some(([url])=>!String(url).includes("timesheet-periods"))).toBe(false)
  await user.click(screen.getByRole("button",{name:"Approve selected timesheets"}))
  await waitFor(()=>expect(updated).toHaveBeenCalledTimes(2))
  const decision=request.mock.calls.find(([url])=>!String(url).includes("timesheet-periods"))
  expect(JSON.parse(decision?.[1]?.body as string)).toMatchObject({status:"approved",batchEntries:[{id:first.id,revision:"first-revision"},{id:second.id,revision:"second-revision"}]})
})

it("returns the whole timesheet but marks only the selected entry rejected",async()=>{
  const updated=vi.fn()
  const correctionDeadline="2099-11-06T12:00:00.000Z"
  const correctionDueAt=correctionDeadline
  const request=vi.fn(async(url:unknown,_init?:RequestInit)=>String(url).includes("timesheet-periods")?Response.json({periods:[{id:"period",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:correctionDeadline}]}):Response.json({entries:[{...first,status:"rejected"},{...second,status:"draft"}]}))
  vi.stubGlobal("fetch",request)
  render(<ApprovalSelection entries={[first,second]} {...props} onUpdated={updated}/> )
  const user=userEvent.setup()
  await screen.findByText("October")
  await user.click(screen.getByRole("checkbox",{name:/Select timesheet Supplier/}))
  await user.click(screen.getByRole("button",{name:"Review 1 timesheet"}))
  await user.click(screen.getByRole("button",{name:"Return one timesheet"}))
  await user.click(screen.getByRole("radio",{name:/Mark Project 2026-10-09 as rejected/}))
  await user.type(screen.getByLabelText("Timesheet return reason"),"Correct the hours")
  await waitFor(()=>expect(screen.getByLabelText("Correction deadline")).toHaveValue("2099-11-06T07:00"))
  expect(request.mock.calls.some(([url])=>!String(url).includes("timesheet-periods"))).toBe(false)
  await user.click(screen.getByRole("button",{name:"Return timesheet"}))
  await waitFor(()=>expect(updated).toHaveBeenCalledTimes(2))
  const decision=request.mock.calls.find(([url])=>!String(url).includes("timesheet-periods"))
  expect(String(decision?.[0])).toContain(first.id)
  expect(JSON.parse(decision?.[1]?.body as string)).toMatchObject({status:"rejected",reviewNote:"Correct the hours",correctionDueAt,expectedRevision:"first-revision",batchEntries:[{id:first.id,revision:"first-revision"},{id:second.id,revision:"second-revision"}]})
})

it("requires a fresh review when any entry changes after confirmation opened",async()=>{
  const {rerender}=render(<ApprovalSelection entries={[first,second]} {...props}/> )
  const user=userEvent.setup()
  await user.click(screen.getByRole("checkbox",{name:/Select timesheet Supplier/}))
  await user.click(screen.getByRole("button",{name:"Review 1 timesheet"}))
  rerender(<ApprovalSelection entries={[first,{...second,revision:"changed-revision",hours:9}]} {...props}/> )
  expect(screen.getByRole("alert")).toHaveTextContent("Evidence changed")
  expect(screen.getByRole("button",{name:"Approve selected timesheets"})).toBeDisabled()
})

it("blocks approval if forwarding capability is missing while allowing return",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({periods:[{id:"period",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2099-11-02T17:00:00.000Z",exceptionResolutionDeadline:"2099-11-06T12:00:00.000Z"}]})))
  render(<ApprovalSelection entries={[{...first,approvalEligible:false}]} {...props}/> )
  const user=userEvent.setup()
  await screen.findByText("October")
  await user.click(screen.getByRole("checkbox",{name:/Select timesheet Supplier/}))
  await user.click(screen.getByRole("button",{name:"Review 1 timesheet"}))
  expect(screen.getByRole("button",{name:"Approve selected timesheets"})).toBeDisabled()
  await user.click(screen.getByRole("button",{name:"Return one timesheet"}))
  expect(screen.getByRole("button",{name:"Return timesheet"})).toBeDisabled()
  await user.click(screen.getByRole("radio",{name:/Mark Project 2026-10-09 as rejected/}))
  await user.type(screen.getByLabelText("Timesheet return reason"),"Needs correction")
  expect(screen.getByRole("button",{name:"Return timesheet"})).toBeEnabled()
})
