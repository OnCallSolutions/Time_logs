/**
 * Verifies employee workflow shortcuts without depending on a live database.
 * Tests assert that correction selection changes only the local view filter.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect, it, vi } from "vitest"
import { EmployeeWorkspace, RoleWorkspaceHome } from "./employee-workspace"

afterEach(()=>vi.unstubAllGlobals())

it.each(["contractor","employee","manager","account_manager"] as const)("puts AI timesheet extraction on the %s landing page when entry creation is allowed",async role=>{
  const onLogTime=vi.fn()
  render(<RoleWorkspaceHome role={role} entries={[]} pending={0} canCreate canReview={false} canReports={false} onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={onLogTime}/> )
  await userEvent.click(screen.getByRole("button",{name:"Extract timesheet with AI"}))
  expect(onLogTime).toHaveBeenCalledOnce()
})

it("hides AI extraction when entry creation is not permitted",()=>{
  render(<RoleWorkspaceHome role="contractor" entries={[]} pending={0} canCreate={false} canReview={false} canReports={false} onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  expect(screen.queryByRole("button",{name:"Extract timesheet with AI"})).not.toBeInTheDocument()
})

it("routes a manager's personal timesheet shortcut independently of team approvals",async()=>{
  const onTimesheets=vi.fn(),onReviews=vi.fn()
  render(<RoleWorkspaceHome role="manager" entries={[]} teamEntries={[]} pending={3} canCreate canReview canReports onTimesheets={onTimesheets} onReviews={onReviews} onLogTime={vi.fn()}/> )
  await userEvent.click(screen.getByRole("button",{name:/My timesheets/}))
  expect(onTimesheets).toHaveBeenCalledOnce()
  expect(onReviews).not.toHaveBeenCalled()
  expect(screen.getByRole("button",{name:/Team approvals/})).toBeVisible()
})

it("selects corrections without offering team or admin actions", async () => {
  const select = vi.fn()
  render(<EmployeeWorkspace entries={[]} selected="all" onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /needs correction/i }))
  expect(select).toHaveBeenCalledWith("rejected")
  expect(screen.queryByRole("button", {name: /approve entry|security|employee access/i})).not.toBeInTheDocument()
})

it("gives contractors a recent-work table, project-hour summary, and scoped export",async()=>{
  const onTimesheets=vi.fn()
  render(<RoleWorkspaceHome role="contractor" entries={[
    {id:"older",contractor:"Taylor",project:"Field",date:"2026-10-14",hours:2,status:"approved",description:"Inspection"},
    {id:"newer",contractor:"Taylor",project:"Setup",date:"2026-10-16",hours:3,status:"rejected",description:"Deployment"},
    {id:"draft",contractor:"Taylor",project:"Field",date:"2026-10-15",hours:1,status:"draft",description:"Notes"},
  ] as never} pending={0} canCreate canReview={false} canReports={false} canExport onTimesheets={onTimesheets} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  const recent=screen.getByRole("region",{name:"Recent contractor work"})
  expect(within(recent).getByRole("button",{name:"Export Recent personal timesheets"})).toBeVisible()
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

it("always shows managers their explicitly assigned employee and contractor directory",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({people:[
    {email:"employee@example.com",displayName:"Avery Employee",role:"employee",contractorNumber:null},
    {email:"contractor@example.com",displayName:"Casey Contractor",role:"contractor",contractorNumber:"TN-0042"},
  ]})))
  render(<RoleWorkspaceHome role="manager" entries={[]} teamEntries={[]} pending={0} canCreate canReview canReports onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  const directory=await screen.findByRole("region",{name:"Team directory"})
  expect(directory).toHaveTextContent("1 employees · 1 contractors assigned to you")
  expect(directory).toHaveTextContent("Avery Employee")
  expect(directory).toHaveTextContent("Casey Contractor")
  await userEvent.selectOptions(within(directory).getByRole("combobox",{name:"Filter team by role"}),"contractor")
  expect(within(directory).getByText("Casey Contractor")).toBeVisible()
  expect(within(directory).queryByText("Avery Employee")).not.toBeInTheDocument()
})

it("shows managers scoped team timesheet activity and an authorized extension request",async()=>{
  const onRequestExtension=vi.fn()
  render(<RoleWorkspaceHome role="manager" entries={[]} teamEntries={[
    {id:"team-1",ownerEmail:"worker@example.com",contractor:"Casey Contractor",project:"Field service",date:"2026-10-17",hours:3,status:"submitted",description:"Site inspection"},
    {id:"team-2",ownerEmail:"worker@example.com",contractor:"Casey Contractor",project:"Field service",date:"2026-10-16",hours:2,status:"approved",description:"Equipment check"},
  ] as never} pending={1} canCreate canReview canReports canExport canRequestExtension onRequestExtension={onRequestExtension} onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  const activity=screen.getByRole("region",{name:"Manager team timesheets"})
  expect(within(activity).getByRole("button",{name:"Export Manager team timesheets"})).toBeVisible()
  expect(activity).toHaveTextContent("Site inspection")
  expect(activity).toHaveTextContent("Showing 2 of 2 submissions")
  await userEvent.type(within(activity).getByRole("searchbox",{name:"Search team timesheets"}),"equipment")
  expect(activity).toHaveTextContent("Showing 1 of 2 submissions")
  expect(activity).not.toHaveTextContent("Site inspection")
  await userEvent.click(screen.getByRole("button",{name:"Request extension"}))
  expect(onRequestExtension).toHaveBeenCalledOnce()
})

it("hides team export controls when the export right is revoked",()=>{
  render(<RoleWorkspaceHome role="manager" entries={[]} teamEntries={[]} pending={0} canCreate canReview canReports canExport={false} onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  expect(screen.getByRole("region",{name:"Manager team timesheets"}).querySelector('[aria-label="Export Manager team timesheets"]')).toBeNull()
  expect(screen.getByRole("region",{name:"Team directory"}).querySelector('[aria-label="Export Team directory"]')).toBeNull()
})

it("does not expose manager extension requests when submission access is revoked",()=>{
  render(<RoleWorkspaceHome role="manager" entries={[]} pending={0} canCreate canReview canReports canRequestExtension={false} onRequestExtension={vi.fn()} onTimesheets={vi.fn()} onReviews={vi.fn()} onLogTime={vi.fn()}/> )
  expect(screen.queryByRole("button",{name:"Request extension"})).not.toBeInTheDocument()
})
