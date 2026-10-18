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
  expect(within(preview).queryByRole("button")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:/October/}))
  expect(onSelect).toHaveBeenCalledWith("current")
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
