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
