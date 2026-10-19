import { render,screen,waitFor,within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { FinalApprovedTimesheets } from "./final-approved-timesheets"
import type { TimeEntry } from "@/lib/types"

afterEach(()=>vi.unstubAllGlobals())

const approvedByAccount:TimeEntry={id:"entry-am",ownerEmail:"patron@example.com",contractor:"Patron One",date:"2026-10-26",hours:4,project:"Field work",description:"Site visit",status:"approved",reviewedBy:"accounts@example.com",reviewManagerEmail:"manager@example.com",revision:"2026-10-27T12:00:00.000Z"}
const approvedByManager:TimeEntry={...approvedByAccount,id:"entry-manager",date:"2026-10-27",reviewedBy:"manager@example.com",revision:"2026-10-27T13:00:00.000Z"}
const submitted:TimeEntry={...approvedByAccount,id:"entry-submitted",date:"2026-10-28",status:"submitted",reviewedBy:null,revision:"2026-10-27T14:00:00.000Z"}

it("shows only the current account manager's final approvals and reopens a complete batch internally",async()=>{
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith("/api/timesheet-periods"))return Response.json({periods:[{id:"period-1",name:"2026-10-24 - 2026-10-30",startDate:"2026-10-24",endDate:"2026-10-30",submissionDeadline:"2026-11-02T22:00:00.000Z",managerGraceDays:2,reminderDays:3}]})
    if(url.endsWith("/api/timesheets/final-approved"))return Response.json({entryIds:["entry-am"]})
    if(url.endsWith("/api/timesheets/reopen-approval")&&init?.method==="POST")return Response.json({entries:[{...approvedByAccount,status:"submitted",reviewedBy:null}]})
    return Response.json({})
  })
  vi.stubGlobal("fetch",fetch)
  const onUpdated=vi.fn()
  render(<FinalApprovedTimesheets email="accounts@example.com" entries={[approvedByAccount,approvedByManager,submitted]} onUpdated={onUpdated}/>);
  await screen.findByText("Patron One")
  await waitFor(()=>expect(screen.queryByText("No account-manager-approved timesheets match this view.")).not.toBeInTheDocument())
  expect(screen.getAllByRole("row")).toHaveLength(2)
  expect(screen.getByText("Field work")).toBeVisible()
  expect(screen.queryByText("No account-manager-approved timesheets match this view.")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("checkbox",{name:/Select approved timesheet Patron One/}))
  await userEvent.click(screen.getByRole("button",{name:/Reopen selected/}))
  const dialog=screen.getByRole("dialog",{name:"Reopen approved timesheets"})
  await userEvent.type(within(dialog).getByRole("textbox",{name:"Reopen reason"}),"Correct project allocation")
  await userEvent.click(within(dialog).getByRole("button",{name:"Return to approval queue"}))
  await waitFor(()=>expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({status:"submitted"})))
  const request=vi.mocked(fetch).mock.calls.find(([url])=>url.endsWith("/api/timesheets/reopen-approval"))
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ownerEmail:"patron@example.com",periodId:"period-1",reason:"Correct project allocation",selection:[{id:"entry-am",revision:approvedByAccount.revision}]})
  expect(screen.getByRole("status")).toHaveTextContent("They were not returned to patrons.")
})
