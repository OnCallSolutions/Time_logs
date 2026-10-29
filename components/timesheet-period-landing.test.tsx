import { render,screen,within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { TimesheetPeriodLanding } from "./timesheet-period-landing"

afterEach(()=>vi.unstubAllGlobals())

it("shows selectable current and archived periods before raw entries",async()=>{
  const onSelect=vi.fn()
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"current",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2026-11-02T17:00:00.000Z"},
    {id:"archive",name:"September",startDate:"2026-09-01",endDate:"2026-09-30",submissionDeadline:"2026-10-02T17:00:00.000Z"},
  ]}))))
  render(<TimesheetPeriodLanding entries={[
    {id:"entry-1",date:"2026-10-10",hours:3,status:"approved",contractor:"Taylor",project:"Field",description:"Recent work"},
    {id:"entry-2",date:"2026-09-10",hours:2,status:"approved",contractor:"Taylor",project:"Archive",description:"Past work",submittedAt:"2026-10-02T17:00:00.000Z"},
  ] as never} onSelect={onSelect}/> )
  await screen.findByRole("button",{name:/October/})
  expect(screen.getByRole("heading",{name:"Timesheet periods"})).toBeVisible()
  expect(screen.getByRole("button",{name:/September/})).toBeVisible()
  expect(screen.getByRole("region",{name:"Period overview"})).toBeVisible()
  expect(screen.getByRole("button",{name:/Open timesheets/})).toBeVisible()
  expect((await screen.findAllByText(/Submit by/)).length).toBe(2)
  expect(screen.getByRole("button",{name:/September/})).toHaveTextContent("Submitted on Oct 2, 2026")
  const preview=screen.getByRole("region",{name:"Current timesheet preview"})
  expect(preview).toHaveTextContent("Recent work · preview")
  expect(preview).toHaveTextContent("Field")
  expect(preview).toHaveTextContent("Recent work")
  expect(preview).toHaveTextContent("3h")
  expect(preview).toHaveTextContent("approved")
  expect(preview).toHaveTextContent("Latest 1 of 1")
  expect(within(preview).queryByRole("button")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:/October/}))
  expect(onSelect).toHaveBeenCalledWith("current")
})

it("shows up to six latest entries in the personal period preview",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"current",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2026-11-02T17:00:00.000Z"},
  ]}))))
  const entries=Array.from({length:8},(_,index)=>({id:`entry-${index}`,date:`2026-10-${String(23-index).padStart(2,"0")}`,hours:1,status:"draft",contractor:"Taylor",project:`Project ${index}`,description:`Work ${index}`}))
  render(<TimesheetPeriodLanding entries={entries as never} onSelect={vi.fn()}/> )
  const preview=await screen.findByRole("region",{name:"Current timesheet preview"})
  expect(preview).toHaveTextContent("Latest 6 of 8")
  expect(within(preview).getByText("Project 0")).toBeInTheDocument()
  expect(within(preview).getByText("Project 5")).toBeInTheDocument()
  expect(within(preview).queryByText("Project 6")).not.toBeInTheDocument()
})

it("filters archived periods by date-window overlap, including periods that begin before the window",async()=>{
  const onSelect=vi.fn()
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"july",name:"July",startDate:"2025-07-01",endDate:"2025-07-19",submissionDeadline:"2025-07-21T17:00:00.000Z"},
    {id:"crossing",name:"Crossing period",startDate:"2025-07-20",endDate:"2025-08-20",submissionDeadline:"2025-08-22T17:00:00.000Z"},
    {id:"august",name:"August",startDate:"2025-08-01",endDate:"2025-08-31",submissionDeadline:"2025-09-02T17:00:00.000Z"},
    {id:"september",name:"September",startDate:"2025-09-01",endDate:"2025-09-30",submissionDeadline:"2025-10-02T17:00:00.000Z"},
  ]}))))
  render(<TimesheetPeriodLanding entries={[]} onSelect={onSelect}/> )
  await screen.findByRole("navigation",{name:"Available timesheet periods"})
  const list=screen.getByRole("navigation",{name:"Available timesheet periods"})
  await screen.findByRole("button",{name:/September/})
  await userEvent.selectOptions(within(list).getByRole("combobox",{name:"Filter timesheet periods"}),"archived")
  await userEvent.type(within(list).getByLabelText("Periods from date"),"2025-08-15")
  await userEvent.type(within(list).getByLabelText("Periods through date"),"2025-09-10")
  expect(within(list).getByRole("button",{name:/Crossing period/})).toBeVisible()
  expect(within(list).getByRole("button",{name:/August/})).toBeVisible()
  expect(within(list).getByRole("button",{name:/September/})).toBeVisible()
  expect(within(list).queryByRole("button",{name:/July/})).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole("button",{name:/September/}))
  expect(onSelect).toHaveBeenCalledWith("september")
})

it("does not show archived periods for an inverted date window and can clear it",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"archive",name:"September",startDate:"2025-09-01",endDate:"2025-09-30",submissionDeadline:"2025-10-02T17:00:00.000Z"},
  ]}))))
  render(<TimesheetPeriodLanding entries={[]} onSelect={vi.fn()}/> )
  await screen.findByRole("navigation",{name:"Available timesheet periods"})
  const list=screen.getByRole("navigation",{name:"Available timesheet periods"})
  await screen.findByRole("button",{name:/September/})
  await userEvent.selectOptions(within(list).getByRole("combobox",{name:"Filter timesheet periods"}),"archived")
  await userEvent.type(within(list).getByLabelText("Periods from date"),"2025-10-01")
  await userEvent.type(within(list).getByLabelText("Periods through date"),"2025-09-01")
  expect(within(list).getByRole("alert")).toHaveTextContent("start date must be on or before")
  expect(within(list).queryByRole("button",{name:/September/})).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole("button",{name:"Clear date range"}))
  expect(within(list).getByRole("button",{name:/September/})).toBeVisible()
})

it("offers a combined saved-timesheets view when no period is selected",async()=>{
  const onSelect=vi.fn()
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[]}))))
  render(<TimesheetPeriodLanding entries={[]} onSelect={onSelect}/> )
  await userEvent.click(await screen.findByRole("button",{name:/All saved periods/}))
  expect(onSelect).toHaveBeenCalledWith("all")
})

it("shows personal record readiness and opens the period for review",async()=>{
  const onSelect=vi.fn()
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"current",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2026-11-02T17:00:00.000Z"},
  ]}))))
  render(<TimesheetPeriodLanding personalReadiness entries={[
    {id:"draft",date:"2026-10-10",hours:3,status:"draft",contractor:"Taylor",project:"Field",description:"Work"},
    {id:"returned",date:"2026-10-11",hours:2,status:"rejected",contractor:"Taylor",project:"Field",description:""},
    {id:"submitted",date:"2026-10-12",hours:4,status:"submitted",contractor:"Taylor",project:"Field",description:"Review"},
  ] as never} onSelect={onSelect}/> )
  expect(await screen.findByRole("region",{name:"Submission readiness"})).toHaveTextContent("Progress reflects saved entries only; no expected hours or workdays are assumed.")
  const readiness=screen.getByRole("region",{name:"Submission readiness"})
  expect(within(readiness).getByText("Drafts to submit").parentElement).toHaveTextContent("1")
  expect(within(readiness).getByText("Returned to correct").parentElement).toHaveTextContent("1")
  expect(within(readiness).getByText("No description").parentElement).toHaveTextContent("1")
  expect(readiness).toHaveTextContent("2 entries need your attention before submission.")
  await userEvent.click(within(readiness).getByRole("button",{name:"Review timesheets"}))
  expect(onSelect).toHaveBeenCalledWith("current")
})

it("gives account managers project and reviewing-manager previews",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({periods:[
    {id:"current",name:"October",startDate:"2026-10-01",endDate:"2026-10-31",submissionDeadline:"2026-11-02T17:00:00.000Z"},
  ]}))))
  render(<TimesheetPeriodLanding role="account_manager" entries={[
    {id:"one",date:"2026-10-10",hours:3,status:"submitted",contractor:"Taylor",project:"Field",description:"Inspection",reviewManagerName:"Morgan Lee"},
    {id:"two",date:"2026-10-11",hours:2,status:"approved",contractor:"Jordan",project:"Field",description:"Setup",reviewManagerName:"Morgan Lee"},
  ] as never} onSelect={vi.fn()}/> )
  const preview=await screen.findByRole("region",{name:"Project and manager preview"})
  expect(preview).toHaveTextContent("Projects in this period")
  expect(preview).toHaveTextContent("Field")
  expect(preview).toHaveTextContent("5h")
  expect(preview).toHaveTextContent("Morgan Lee")
  expect(screen.getByRole("region",{name:"Period overview"})).toHaveClass("overflow-y-auto")
  expect(screen.getByRole("navigation",{name:"Available timesheet periods"})).toHaveClass("overflow-auto")
})
