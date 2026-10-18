/**
 * Verifies employee workflow shortcuts without depending on a live database.
 * Tests assert that correction selection changes only the local view filter.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect, it, vi } from "vitest"
import { EmployeeWorkspace, RoleWorkspaceHome } from "./employee-workspace"

afterEach(()=>vi.unstubAllGlobals())

it("selects corrections without offering team or admin actions", async () => {
  const select = vi.fn()
  render(<EmployeeWorkspace entries={[]} selected="all" onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /needs correction/i }))
  expect(select).toHaveBeenCalledWith("rejected")
  expect(screen.queryByRole("button", {name: /approve entry|security|employee access/i})).not.toBeInTheDocument()
})

it("gives contractors a recent-work table and project-hour summary",async()=>{
  const onTimesheets=vi.fn()
  render(<RoleWorkspaceHome role="contractor" entries={[
    {id:"older",contractor:"Taylor",project:"Field",date:"2026-10-14",hours:2,status:"approved",description:"Inspection"},
    {id:"newer",contractor:"Taylor",project:"Setup",date:"2026-10-16",hours:3,status:"rejected",description:"Deployment"},
    {id:"draft",contractor:"Taylor",project:"Field",date:"2026-10-15",hours:1,status:"draft",description:"Notes"},
  ] as never} pending={0} canCreate canReview={false} canReports={false} onTimesheets={onTimesheets} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  const recent=screen.getByRole("region",{name:"Recent contractor work"})
  expect(recent).toHaveTextContent("Deployment")
  expect(recent).toHaveTextContent("Needs correction")
  expect(recent.querySelector("tbody")?.firstElementChild).toHaveTextContent("2026-10-16")
  const projects=screen.getByRole("region",{name:"Hours by project"})
  expect(projects).toHaveTextContent("Field")
  expect(projects).toHaveTextContent("3h")
  expect(screen.getByRole("region",{name:"contractor workspace home"})).toHaveTextContent(/1\s*returned/)
  await userEvent.click(within(recent).getByRole("button",{name:/All timesheets/}))
  expect(onTimesheets).toHaveBeenCalledOnce()
})

it("shows account managers a compact personal-timesheet snapshot",async()=>{
  const onTimesheets=vi.fn()
  render(<RoleWorkspaceHome role="account_manager" entries={[
    {id:"submitted",contractor:"Morgan",project:"Operations",date:"2026-10-16",hours:4,status:"submitted",description:"Review packet"},
    {id:"approved",contractor:"Morgan",project:"Operations",date:"2026-10-15",hours:2,status:"approved",description:"Closeout"},
  ] as never} pending={0} canCreate={false} canReview canReports={false} canManagePeriods onTimesheets={onTimesheets} onReviews={vi.fn()} onLogTime={vi.fn()} onFinalApprovals={vi.fn()} onPeriodSettings={vi.fn()}/> )
  const summary=screen.getByRole("region",{name:"My timesheet summary"})
  expect(summary).toHaveTextContent("2")
  expect(summary).toHaveTextContent("Awaiting review")
  const recent=screen.getByRole("region",{name:"Recent personal entries"})
  expect(recent).toHaveTextContent("Review packet")
  expect(screen.getByRole("region",{name:"account_manager workspace home"})).toHaveTextContent("6h")
  await userEvent.click(within(recent).getByRole("button",{name:/All timesheets/}))
  expect(onTimesheets).toHaveBeenCalledOnce()
})

it("shows managers with team visibility their assigned employee and contractor directory",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({people:[
    {email:"employee@example.com",displayName:"Avery Employee",role:"employee",contractorNumber:null},
    {email:"contractor@example.com",displayName:"Casey Contractor",role:"contractor",contractorNumber:"TN-0042"},
  ]})))
  render(<RoleWorkspaceHome role="manager" entries={[]} teamEntries={[]} pending={0} canCreate canReview canReports canViewTeamDirectory onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  const directory=await screen.findByRole("region",{name:"Team directory"})
  expect(directory).toHaveTextContent("1 employees · 1 contractors assigned to you")
  expect(directory).toHaveTextContent("Avery Employee")
  expect(directory).toHaveTextContent("Casey Contractor")
  await userEvent.selectOptions(within(directory).getByRole("combobox",{name:"Filter team by role"}),"contractor")
  expect(within(directory).getByText("Casey Contractor")).toBeVisible()
  expect(within(directory).queryByText("Avery Employee")).not.toBeInTheDocument()
})
