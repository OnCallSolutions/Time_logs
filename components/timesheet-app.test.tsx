/**
 * Exercises the role-aware timesheet shell at the component boundary.
 *
 * Child widgets are mocked so these tests can focus on the admin directory:
 * seniority ordering and the required Edit -> modal choices -> Save workflow.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { signIn } from "next-auth/react"
import { TimesheetApp } from "@/components/timesheet-app"
import { resolvePermissions } from "@/lib/permissions"

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }))

vi.mock("@/components/account-profile", () => ({
  AccountProfile: () => <div data-testid="account-profile" />,
}))

vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}))

vi.mock("@/components/note-input", () => ({
  NoteInput: () => <div data-testid="note-input" />,
}))

vi.mock("@/components/entries-log", () => ({
  EntriesLog: ({periodToolbarCenter}:{periodToolbarCenter?:ReactNode}) => <div data-testid="entries-log">{periodToolbarCenter}</div>,
}))

vi.mock("@/components/manager-report", () => ({
  ManagerReport: () => <div data-testid="manager-report" />,
}))

type FetchCall = {
  url: string
  method: string
  body: unknown
}

const fetchCalls: FetchCall[] = []
const adminUsers = [
  {
    email: "employee@example.com",
    role: "employee",
    accessStatus: "active",
    accessSource: "managed",
    accessConfigured: true,
    note: "",
    updatedBy: null,
    updatedAt: null,
    displayName: "",
    companyReference: "TN-000001",
    contractorNumber: "TN-internal-employee",
    imageDataUrl: null,
    totalEntries: 2,
    draftEntries: 1,
    submittedEntries: 1,
    approvedEntries: 0,
    rejectedEntries: 0,
    lastEntryAt: null,
  },
  {
    email: "admin@example.com",
    role: "admin",
    accessStatus: "active",
    accessSource: "environment",
    accessConfigured: true,
    note: "",
    updatedBy: null,
    updatedAt: null,
    displayName: "",
    companyReference: "TN-000002",
    contractorNumber: "TN-internal-admin",
    imageDataUrl: null,
    totalEntries: 0,
    draftEntries: 0,
    submittedEntries: 0,
    approvedEntries: 0,
    rejectedEntries: 0,
    lastEntryAt: null,
  },
  {
    email: "manager@example.com",
    role: "manager",
    accessStatus: "active",
    accessSource: "managed",
    accessConfigured: true,
    note: "",
    updatedBy: null,
    updatedAt: null,
    displayName: "",
    companyReference: "TN-000003",
    contractorNumber: "TN-internal-manager",
    imageDataUrl: null,
    totalEntries: 1,
    draftEntries: 0,
    submittedEntries: 0,
    approvedEntries: 1,
    rejectedEntries: 0,
    lastEntryAt: null,
  },
]

/**
 * Builds a Response containing JSON data for fetch mocks.
 *
 * @param data - JSON-serializable body returned by the mocked endpoint.
 * @param status - HTTP status to expose on the mocked response.
 * @returns Fetch-compatible Response object.
 */
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Installs a fetch mock for the timesheet shell and admin APIs.
 *
 * The admin PATCH response echoes the saved payload the way the route does,
 * adding audit metadata fields used by the directory state merge.
 *
 * @returns The installed fetch mock for additional assertions.
 */
function mockTimesheetFetch(entries:unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url === "/tanovo-time/api/auth/csrf?stepup=1") return jsonResponse({csrfToken:"test-csrf-token"})
    if (url.startsWith("/tanovo-time/api/auth/signin/microsoft-entra-id?stepup=1")) return jsonResponse({url:"https://login.microsoftonline.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftanovo-time%2Fapi%2Fauth%2Fcallback%2Fmicrosoft-entra-id"})
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (url === "/tanovo-time/api/permissions") return jsonResponse({role:"admin",permissions:resolvePermissions("admin")})
    fetchCalls.push({ url, method, body })

    if (url === "/tanovo-time/api/assistant/conversations" && method === "POST") return jsonResponse({ messages: [] })

    if (url === "/tanovo-time/api/entries") {
      return jsonResponse({ entries })
    }
    if (url === "/tanovo-time/api/timesheet-periods") return jsonResponse({ periods: [{ id: "period-october", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", submissionDeadline: "2026-11-02T17:00:00.000Z", managerGraceDays: 3, reminderDays: 3 }] })

    if (url === "/tanovo-time/api/users" && method === "GET") {
      return jsonResponse({ users: adminUsers })
    }

    if (url === "/tanovo-time/api/users" && method === "PATCH") {
      return jsonResponse({
        user: {
          email: body.email.toLowerCase(),
          role: body.role,
          accessStatus: body.accessStatus,
          note: body.note ?? "",
          updatedBy: "admin@example.com",
          updatedAt: "2026-10-06T12:00:00.000Z",
        },
      })
    }

    if (url === "/tanovo-time/api/people" && method === "PATCH") {
      return jsonResponse({ identity: { email: body.email, officialName: "Person Updated", shortReference: "TN-000001", contractorNumber: "TN-internal-employee", employeeId: body.employeeId } })
    }

    if (url === "/tanovo-time/api/audit?limit=25") {
      return jsonResponse({ events: [] })
    }

    if (url === "/tanovo-time/api/audit?limit=250") {
      return jsonResponse({ events: [{
        id: "audit-1",
        actorEmail: "admin@example.com",
        action: "entry_approved",
        targetType: "time_entry",
        targetId: "entry-1",
        metadata: { fromStatus: "submitted", toStatus: "approved", changedFields: ["status"] },
        ipAddress: "203.0.113.10",
        userAgent: "Test browser",
        requestMethod: "PATCH",
        requestPath: "/tanovo-time/api/entries/entry-1",
        requestId: "req-test-1",
        occurredAt: "2026-10-17T12:00:00.000Z",
      },{
        id:"audit-rights",
        actorEmail:"manager@example.com",
        action:"user_access_updated",
        targetType:"managed_user_access",
        targetId:"employee@example.com",
        metadata:{fromRole:"contractor",toRole:"employee",permissionsChanged:true,beforePermissions:{review_entries:false},afterPermissions:{review_entries:true}},
        ipAddress:null,userAgent:null,requestMethod:"PATCH",requestPath:"/tanovo-time/api/users",requestId:null,
        occurredAt:"2026-10-17T11:59:00.000Z",
      },{
        id:"audit-period",
        actorEmail:"manager@example.com",
        action:"timesheet_period_created",
        targetType:"timesheet_period",
        targetId:"period-id",
        metadata:{name:"November 2026",startDate:"2026-11-01",endDate:"2026-11-30"},
        ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/tanovo-time/api/timesheet-periods",requestId:null,
        occurredAt:"2026-10-17T11:58:00.000Z",
      },{
        id:"audit-period-update",
        actorEmail:"admin@example.com",
        action:"timesheet_period_updated",
        targetType:"timesheet_period",
        targetId:"period-id",
        metadata:{reason:"Adjusted deadline",before:{name:"November 2026",endDate:"2026-11-30"},after:{name:"November 2026",endDate:"2026-12-01"}},
        ipAddress:null,userAgent:null,requestMethod:"PATCH",requestPath:"/tanovo-time/api/timesheet-periods",requestId:null,
        occurredAt:"2026-10-17T11:57:30.000Z",
      },{
        id:"audit-project",
        actorEmail:"manager@example.com",
        action:"project_created",
        targetType:"time_project",
        targetId:"project-id",
        metadata:{name:"Facility retrofit"},
        ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/tanovo-time/api/projects",requestId:null,
        occurredAt:"2026-10-17T11:57:00.000Z",
      },{
        id:"audit-project-update",
        actorEmail:"admin@example.com",
        action:"project_updated",
        targetType:"time_project",
        targetId:"project-id",
        metadata:{name:"Facility retrofit",active:false,previousActive:true},
        ipAddress:null,userAgent:null,requestMethod:"PATCH",requestPath:"/tanovo-time/api/projects",requestId:null,
        occurredAt:"2026-10-17T11:56:00.000Z",
      },{
        id:"audit-api-error",
        actorEmail:"contractor@example.com",
        action:"client_error_reported",
        targetType:"client_error",
        targetId:"e4b21455-ca7d-468c-aee9-3b6a9d3767ea",
        metadata:{operation:"entry.submit",route:"/api/entries/[id]",httpMethod:"PATCH",httpStatus:503,errorCode:"42P18",message:"Submission could not be confirmed."},
        ipAddress:null,userAgent:null,requestMethod:"POST",requestPath:"/tanovo-time/api/client-errors",requestId:null,
        occurredAt:"2026-10-17T11:55:00.000Z",
      }] })
    }

    return jsonResponse({ error: `Unhandled test URL: ${url}` }, 404)
  })

  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/**
 * Renders the app and opens the nested admin directory window.
 *
 * @returns User-event controller after the admin panel is visible.
 */
async function renderAdminPanel() {
  const user = userEvent.setup()

  render(
    <TimesheetApp
      role="admin"
      userEmail="admin@example.com"
      userName="Admin User"
    />,
  )

  const commands = await screen.findByRole("navigation", { name: "Admin dashboard commands" })
  expect(screen.queryByRole("dialog", { name: "Admin dashboard" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "People and access" })).toBeVisible()
  await user.click(within(commands).getByRole("button", { name: "Admin" }))
  await user.click(await screen.findByRole("button", { name: "Patron access and rights" }))
  await screen.findByRole("heading", { name: /admin user directory/i })

  return user
}

function patronRows(directory:HTMLElement){return within(directory).getAllByRole("row").filter(row=>within(row).queryByRole("button",{name:/^edit$/i}))}

describe("TimesheetApp admin directory", () => {
  beforeEach(() => {
    fetchCalls.length = 0
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: "", code: "", status: 200, url: "/tanovo-time/api/auth/signin/microsoft-entra-id" })
    vi.spyOn(window, "open").mockReturnValue({
      location: { href: "about:blank" },
      close: vi.fn(),
    } as unknown as Window)
    mockTimesheetFetch()
  })

  it("orders people by descending seniority without exposing account identifiers in the roster", async () => {
    await renderAdminPanel()

    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")

    expect(directory).not.toBeNull()

    const rows = patronRows(directory as HTMLElement)

    expect(rows[0]).toHaveTextContent("Name not set")
    expect(rows[0]).toHaveTextContent("admin")
    expect(rows[1]).toHaveTextContent("manager")
    expect(rows[2]).toHaveTextContent("employee")
    expect(directory).not.toHaveTextContent("TN-")
    expect(directory).not.toHaveTextContent("@example.com")
  })

  it("returns directly from an admin command to its originating landing page",async()=>{
    const user=userEvent.setup()
    render(<TimesheetApp role="admin" userEmail="admin@example.com" userName="Admin User"/>)
    const commands=await screen.findByRole("navigation",{name:"Admin dashboard commands"})
    await user.click(within(commands).getByRole("button",{name:"Admin"}))
    const admin=await screen.findByRole("dialog",{name:"Admin"})
    expect(screen.queryByRole("dialog",{name:"Admin dashboard"})).not.toBeInTheDocument()
    await user.click(within(admin).getByRole("button",{name:"Back"}))
    expect(screen.queryByRole("dialog",{name:"Admin"})).not.toBeInTheDocument()
    expect(screen.getByRole("region",{name:"People and access"})).toBeVisible()
  })

  it("restores the same workspace page after a refresh",async()=>{
    const user=userEvent.setup()
    const props={role:"admin" as const,userEmail:"admin@example.com",userName:"Admin User"}
    const firstRender=render(<TimesheetApp {...props}/> )
    await user.click(within(await screen.findByRole("navigation",{name:"Workspaces"})).getByRole("button",{name:"Timesheets"}))
    await screen.findByRole("dialog",{name:"Timesheets"})
    expect(JSON.parse(window.sessionStorage.getItem("tanovo-time:workspace-page:admin@example.com")??"{}")).toMatchObject({view:"admin",adminStartSection:"timesheets",pageWindow:true})

    firstRender.unmount()
    render(<TimesheetApp {...props}/> )
    expect(await screen.findByRole("dialog",{name:"Timesheets"})).toBeVisible()
  })

  it("shows colorful audit categories in a full-screen activity window and reveals sensitive metadata on selection", async () => {
    const user = userEvent.setup()
    render(<TimesheetApp role="admin" userEmail="admin@example.com" userName="Admin User" />)
    const commands = await screen.findByRole("navigation", { name: "Admin dashboard commands" })
    await user.click(within(commands).getByRole("button", { name: "Reports" }))
    const reports = await screen.findByRole("dialog", { name: "Reports" })
    await user.click(within(reports).getByRole("button", { name: "Open activity log" }))

    const activity = await screen.findByRole("dialog", { name: "All app activity" })
    expect(activity).toHaveAttribute("data-window-expanded", "true")
    expect(within(activity).getByRole("searchbox",{name:"Search audit logs"})).toBeVisible()
    expect(within(activity).getByRole("combobox",{name:"Group audit logs by",hidden:true})).not.toBeVisible()
    await user.click(within(activity).getByText("View options"))
    expect(within(activity).getByRole("combobox",{name:"Group audit logs by"})).toBeVisible()
    expect(within(activity).getByRole("combobox",{name:"Audit timesheet period filter"})).toBeVisible()
    expect(within(activity).getByText("Distinct actors")).toBeVisible()
    expect(within(activity).getByText("entry approved")).toHaveClass("bg-emerald-50")
    expect(within(activity).getByText("time entry")).toHaveClass("bg-blue-50")
    expect(within(activity).queryByText("/tanovo-time/api/entries/entry-1")).not.toBeInTheDocument()
    expect(within(activity).queryByText("203.0.113.10")).not.toBeInTheDocument()

    await user.click(within(activity).getByRole("row", { name: /admin@example.com entry approved/i }))
    const details = await within(activity).findByRole("region", { name: "Activity detail" })
    expect(within(details).getByText("/tanovo-time/api/entries/entry-1")).toBeVisible()
    expect(within(details).getByText("203.0.113.10")).toBeVisible()
    expect(within(details).getByText(/fromStatus/)).toBeVisible()
    expect(within(details).getByText("req-test-1")).toBeVisible()
    await user.click(within(activity).getByRole("row", { name: /admin@example.com entry approved/i }))
    expect(within(activity).queryByRole("region", { name: "Activity detail" })).not.toBeInTheDocument()
  })

  it("opens a dedicated API error report with the endpoint, HTTP status, diagnostic code, and reference",async()=>{
    const user=userEvent.setup()
    render(<TimesheetApp role="admin" userEmail="admin@example.com" userName="Admin User"/>)
    const commands=await screen.findByRole("navigation",{name:"Admin dashboard commands"})
    await user.click(within(commands).getByRole("button",{name:"Reports"}))
    const reports=await screen.findByRole("dialog",{name:"Reports"})
    await user.click(within(reports).getByRole("button",{name:"Open API error report"}))
    const report=await screen.findByRole("dialog",{name:"API error report"})
    await waitFor(()=>expect(fetchCalls.some(call=>call.url==="/tanovo-time/api/audit?limit=250")).toBe(true))
    expect(await within(report).findByText("PATCH /api/entries/[id]",{exact:false})).toBeVisible()
    expect(within(report).getByText("42P18")).toBeVisible()
    expect(within(report).getByText("503")).toBeVisible()
    expect(within(report).getByText(/e4b21455-ca7d-468c-aee9-3b6a9d3767ea/)).toBeVisible()
  })

  it("opens dedicated admin reports for access, period, and project creation history",async()=>{
    const user=userEvent.setup()
    render(<TimesheetApp role="admin" userEmail="admin@example.com" userName="Admin User"/>)
    const commands=await screen.findByRole("navigation",{name:"Admin dashboard commands"})
    await user.click(within(commands).getByRole("button",{name:"Reports"}))
    const reports=await screen.findByRole("dialog",{name:"Reports"})

    await user.click(within(reports).getByRole("button",{name:"View rights changes"}))
    let report=await screen.findByRole("dialog",{name:"Access change history"})
    const rightsRow=within(report).getByRole("row",{name:/manager@example.com user access updated/i})
    expect(rightsRow).toHaveTextContent("employee@example.com")
    expect(rightsRow).toHaveTextContent("Oct 17, 2026")
    const exportButton=within(report).getByRole("button",{name:"Export 1 visible report events as CSV"})
    expect(exportButton).toBeEnabled()
    const originalCreate=Object.getOwnPropertyDescriptor(URL,"createObjectURL")
    const createObjectUrl=vi.fn(()=>"blob:test")
    Object.defineProperty(URL,"createObjectURL",{configurable:true,value:createObjectUrl})
    const clickLink=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{})
    await user.click(exportButton)
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(clickLink).toHaveBeenCalledOnce()
    clickLink.mockRestore()
    if(originalCreate)Object.defineProperty(URL,"createObjectURL",originalCreate)
    else Reflect.deleteProperty(URL,"createObjectURL")
    await user.click(within(report).getByRole("row",{name:/manager@example.com user access updated/i}))
    expect(await within(report).findByRole("region",{name:"Activity detail"})).toHaveTextContent("beforePermissions")
    await user.click(within(report).getByRole("button",{name:"Close activity window"}))

    await user.click(within(reports).getByRole("button",{name:"View period history"}))
    report=await screen.findByRole("dialog",{name:"Timesheet period history"})
    const periodRow=within(report).getByRole("row",{name:/manager@example.com timesheet period created/i})
    expect(periodRow).toHaveTextContent("November 2026")
    expect(periodRow).toHaveTextContent("2026-11-01 – 2026-11-30")
    expect(within(report).getByRole("row",{name:/admin@example.com timesheet period updated/i})).toBeVisible()
    await user.click(within(report).getByRole("button",{name:"Close activity window"}))

    await user.click(within(reports).getByRole("button",{name:"View project history"}))
    report=await screen.findByRole("dialog",{name:"Project history"})
    expect(within(report).getByRole("row",{name:/manager@example.com project created/i})).toHaveTextContent("Facility retrofit")
    expect(within(report).getByRole("row",{name:/admin@example.com project updated/i})).toBeVisible()
  })

  it("uses the admin landing area to find people and resolve access issues", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))

    const roster = screen.getByRole("region", { name: "People and access" })
    expect(within(roster).getByRole("heading", { name: "People and access" })).toBeVisible()
    expect(roster).toHaveTextContent("Resolve identity, access, and account health issues")
    expect(within(roster).getByRole("table")).toBeVisible()
    expect(within(roster).getAllByRole("row")).toHaveLength(4)
    await user.selectOptions(within(roster).getByLabelText("Filter patrons by role"), "manager")
    expect(within(roster).getAllByRole("row")).toHaveLength(2)
    expect(within(roster).getByText("manager", { selector: "span" })).toBeVisible()
    expect(within(roster).queryByText("employee", { selector: "span" })).not.toBeInTheDocument()
    await user.selectOptions(within(roster).getByLabelText("Filter people by access status"), "needs_attention")
    expect(within(roster).getAllByRole("row")).toHaveLength(2)
    expect(within(roster).getByText("manager", { selector: "span" })).toBeVisible()
  })

  it("keeps analytical reports separate from raw timesheet entries", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("navigation", { name: "Admin dashboard commands" })).getByRole("button", { name: "Reports" }))
    const reports = await screen.findByRole("dialog", { name: "Reports" })
    expect(within(reports).getByRole("button", { name: "Open analytics report" })).toBeVisible()
    expect(within(reports).getByRole("button", { name: "Open activity log" })).toBeVisible()
    expect(within(reports).getByRole("button", { name: "Open security risks" })).toBeVisible()
    await user.click(within(reports).getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("navigation", { name: "Admin dashboard commands" })).getByRole("button", { name: "Timesheets" }))
    const timesheets = await screen.findByRole("dialog", { name: "Timesheets" })
    expect(within(timesheets).getByRole("button", { name: /Period settings/ })).toBeVisible()
    expect(within(timesheets).queryByTestId("entries-log")).not.toBeInTheDocument()
    const periodIndex=within(timesheets).getByRole("navigation",{name:"Timesheet periods"})
    await user.click(within(timesheets).getByRole("button", { name: /Period settings/ }))
    const periodWindow = await screen.findByRole("dialog", { name: "Timesheet period settings" })
    expect(within(periodWindow).getByRole("heading", { name: "Timesheet periods and submission windows" })).toBeVisible()
    await user.click(within(periodWindow).getByRole("button",{name:"Add period"}))
    const periodEditor=await screen.findByRole("dialog",{name:"Add submission window"})
    expect(within(periodEditor).getByRole("button",{name:"Cancel"})).toBeVisible()
    expect(within(periodEditor).getByRole("button",{name:"Create period"})).toBeVisible()
    await user.click(within(periodEditor).getByRole("button",{name:"Cancel"}))
    await user.click(within(periodWindow).getByRole("button", { name: "Back" }))
    await user.click(within(periodIndex).getByRole("button", { name: /October 2026/ }))
    await user.click(within(timesheets).getByRole("button", { name: /Open timesheets/ }))
    const entryWindow = await screen.findByRole("dialog", { name: "Timesheet view" })
    expect(within(entryWindow).getByTestId("entries-log")).toBeInTheDocument()
    expect(within(entryWindow).getByRole("button", { name: "Log time" })).toBeVisible()
    await user.click(within(entryWindow).getByRole("button",{name:"Log time"}))
    const captureWindow=await screen.findByRole("dialog",{name:"Create timesheet entries"})
    expect(captureWindow).toHaveAttribute("data-window-expanded","true")
    expect(within(captureWindow).queryByRole("button",{name:"Restore window"})).not.toBeInTheDocument()
    expect(within(captureWindow).getByTestId("note-input")).toBeVisible()
    await user.click(within(captureWindow).getByRole("button",{name:"Back"}))
    await waitFor(()=>expect(entryWindow).toBeVisible())
    const reviewLauncher=within(entryWindow).getByRole("button",{name:"Review queue"})
    expect(reviewLauncher).toBeVisible()
    expect(reviewLauncher.closest("details")).toBeNull()
    await user.click(reviewLauncher)
    const reviewWindow=await screen.findByRole("dialog",{name:"Review queue"})
    expect(reviewWindow).toHaveAttribute("data-window-expanded","true")
    expect(within(reviewWindow).getByRole("heading",{name:"Timesheets awaiting review"})).toBeVisible()
    expect(within(reviewWindow).getByRole("button", { name: "AI suggestions" })).toBeVisible()
    await user.click(within(reviewWindow).getByRole("button", { name: "Back" }))
    await waitFor(()=>expect(entryWindow).toBeVisible())
    expect(within(entryWindow).getByTestId("entries-log")).toBeInTheDocument()
    expect(within(entryWindow).getByRole("button", { name: "Refresh entries" })).toBeVisible()
    await user.click(within(entryWindow).getByRole("button", { name: "Back" }))
    await user.click(within(timesheets).getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("navigation", { name: "Admin dashboard commands" })).getByRole("button", { name: "Reports" }))
    const reportsAgain = await screen.findByRole("dialog", { name: "Reports" })
    await user.click(within(reportsAgain).getByRole("button", { name: "Open analytics report" }))
    const analyticsReport = await screen.findByRole("dialog", { name: "Analytics reports" })
    expect(within(analyticsReport).getByTestId("manager-report")).toBeInTheDocument()
  },15000)

  it("shows every entry for the selected period in the scrollable preview", async () => {
    const entries=Array.from({length:12},(_,index)=>({
      id:`entry-${index}`,
      date:`2026-10-${String(23-index).padStart(2,"0")}`,
      hours:1.25,
      status:"draft",
      contractor:"Taylor",
      project:`Period project ${index}`,
      description:`Period work ${index}`,
    }))
    mockTimesheetFetch(entries)
    const user=userEvent.setup()
    render(<TimesheetApp role="admin" userEmail="admin@example.com" userName="Admin User"/>)
    const commands=await screen.findByRole("navigation",{name:"Admin dashboard commands"})
    await user.click(within(commands).getByRole("button",{name:"Timesheets"}))
    const period=await screen.findByRole("region",{name:"Selected timesheet period"})
    expect(within(period).getByText("Showing 12 of 12")).toBeVisible()
    for(const index of entries.keys()) expect(within(period).getByText(`Period project ${index}`)).toBeInTheDocument()
    expect(period.querySelector("div.overflow-auto")).toBeInTheDocument()
  })

  it("opens the floating assistant over the workspace and focuses its composer", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))

    expect(screen.queryByRole("region", { name: "DevOnCall assistant" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Go to DevOnCall assistant" }))
    const mainAssistant = await screen.findByRole("region", { name: "DevOnCall assistant" })
    expect(within(mainAssistant).getByRole("heading", { name: "DevOnCall" })).toBeVisible()
    expect(document.querySelector("[data-assistant-overlay='true']")).toHaveClass("fixed")
    expect((document.querySelector("[data-assistant-overlay='true']") as HTMLElement).style.right).toBe("12px")
    const composer = within(mainAssistant).getByLabelText("Ask DevOnCall")
    await waitFor(() => expect(composer).toHaveFocus())
    expect(within(mainAssistant).getByText("Tanovo Time · Workspace assistant")).toBeVisible()
    expect(screen.getAllByRole("region", { name: "DevOnCall assistant" })).toHaveLength(1)
  })

  it("lets patrons drag the assistant and resize it upward without leaving the viewport", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))
    await user.click(screen.getByRole("button", { name: "Go to DevOnCall assistant" }))
    const assistant=await screen.findByRole("region",{name:"DevOnCall assistant"})
    const overlay=document.querySelector<HTMLElement>("[data-assistant-overlay='true']")!
    vi.spyOn(overlay,"getBoundingClientRect").mockReturnValue({x:500,y:300,left:500,top:300,right:900,bottom:680,width:400,height:380,toJSON:()=>({})})
    const header=within(assistant).getByRole("heading",{name:"DevOnCall"}).closest("header")!
    fireEvent.pointerDown(header,{pointerId:11,clientX:540,clientY:320})
    fireEvent.pointerMove(header,{pointerId:11,clientX:440,clientY:220})
    fireEvent.pointerUp(header,{pointerId:11,clientX:440,clientY:220})
    expect(overlay.style.left).toBe("400px")
    expect(overlay.style.top).toBe("200px")

    const resize=screen.getByRole("separator",{name:"Resize assistant panel"})
    fireEvent.pointerDown(resize,{pointerId:12,clientY:200})
    fireEvent.pointerMove(resize,{pointerId:12,clientY:-1000})
    fireEvent.pointerUp(resize,{pointerId:12,clientY:-1000})
    expect(Number.parseFloat(overlay.style.height)).toBeLessThan(window.innerHeight)
    expect(Number.parseFloat(overlay.style.top)).toBeGreaterThanOrEqual(8)
  })

  it("saves role and permission changes only from the edit dialog", async () => {
    const user = await renderAdminPanel()
    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")
    const rows = patronRows(directory as HTMLElement)
    const employeeRow = rows.find((row) => row.textContent?.includes("employee"))

    expect(employeeRow).toBeDefined()
    expect(
      within(directory as HTMLElement).queryByRole("button", {
        name: /^manager$/i,
      }),
    ).not.toBeInTheDocument()

    await user.click(
      within(employeeRow as HTMLElement).getByRole("button", {
        name: /edit/i,
      }),
    )

    const dialog = await screen.findByRole("dialog", {
      name: /edit patron access/i,
    })
    expect(dialog).toHaveAttribute("data-window-resizable", "true")
    expect(dialog).toHaveAttribute("data-window-expanded", "true")
    expect(within(dialog).getByRole("button", { name: "Account manager" })).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Export visible timesheets")).not.toBeVisible()
    await user.click(within(dialog).getByText("Team review and reporting"))
    expect(within(dialog).getByLabelText("Export visible timesheets")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Account manager" }).parentElement).toHaveClass("role-choice-grid")
    expect(within(dialog).queryByRole("button", { name: "Restore size" })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: /^manager$/i }))
    await user.click(within(dialog).getByRole("button", { name: /^blocked$/i }))
    await user.type(
      within(dialog).getByLabelText(/administrator note/i),
      "Needs review",
    )
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }))

    const confirmation = await screen.findByRole("dialog", { name: "Confirm access change" })
    expect(within(confirmation).getByText(/confirm your identity with microsoft/i)).toBeInTheDocument()
    await user.click(within(confirmation).getByRole("button", { name: /verify with microsoft/i }))

    await waitFor(() => expect(window.sessionStorage.getItem("tanovo-time:pending-access-change")).not.toBeNull())
    expect(fetchCalls.some(call => call.url === "/tanovo-time/api/users" && call.method === "PATCH")).toBe(false)
  })

  it("requires an explicit final confirmation before saving ordinary changes", async () => {
    const user = await renderAdminPanel()
    const directory = screen.getByRole("heading", { name: /admin user directory/i }).closest("section") as HTMLElement
    const employeeRow = patronRows(directory).find(row => row.textContent?.includes("employee")) as HTMLElement
    await user.click(within(employeeRow).getByRole("button", { name: /edit/i }))
    const editor = await screen.findByRole("dialog", { name: /edit patron access/i })
    await user.type(within(editor).getByLabelText(/administrator note/i), "Routine note")
    await user.click(within(editor).getByRole("button", { name: /^save$/i }))

    const confirmation = await screen.findByRole("dialog", { name: "Confirm access change" })
    expect(within(confirmation).queryByText(/confirm your identity with microsoft/i)).not.toBeInTheDocument()
    expect(fetchCalls.some(call => call.url === "/tanovo-time/api/users" && call.method === "PATCH")).toBe(false)
    await user.click(within(confirmation).getByRole("button", { name: /confirm and save/i }))

    await waitFor(() => expect(fetchCalls.find(call => call.url === "/tanovo-time/api/users" && call.method === "PATCH")?.body).toEqual({
      email: "employee@example.com",
      role: "employee",
      accessStatus: "active",
      note: "Routine note",
      permissions: {},
    }))
  })

  it("describes account lifecycle states and saves suspension as access control", async () => {
    const user = await renderAdminPanel()
    const directory = screen.getByRole("heading", { name: /admin user directory/i }).closest("section")
    const employeeRow = patronRows(directory as HTMLElement).find(row => row.textContent?.includes("employee"))
    await user.click(within(employeeRow as HTMLElement).getByRole("button", { name: /edit/i }))
    const dialog = await screen.findByRole("dialog", { name: /edit patron access/i })
    await user.click(within(dialog).getByRole("button", { name: /^suspended$/i }))
    expect(within(dialog).getByText(/temporary hold for leave, contract verification, investigation, or access review/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }))
    const confirmation = await screen.findByRole("dialog", { name: "Confirm access change" })
    expect(within(confirmation).getByText(/confirm your identity with microsoft/i)).toBeInTheDocument()
    await user.click(within(confirmation).getByRole("button", { name: /verify with microsoft/i }))
    await waitFor(() => expect(window.sessionStorage.getItem("tanovo-time:pending-access-change")).not.toBeNull())
    expect(fetchCalls.some(call => call.url === "/tanovo-time/api/users" && call.method === "PATCH")).toBe(false)
  })

  it("distinguishes offboarding, security blocks, and not-approved onboarding", async () => {
    const user = await renderAdminPanel()
    const directory = screen.getByRole("heading", { name: /admin user directory/i }).closest("section")
    const employeeRow = patronRows(directory as HTMLElement).find(row => row.textContent?.includes("employee"))
    await user.click(within(employeeRow as HTMLElement).getByRole("button", { name: /edit/i }))
    const dialog = await screen.findByRole("dialog", { name: /edit patron access/i })

    await user.click(within(dialog).getByRole("button", { name: "Offboarded" }))
    expect(within(dialog).getByText(/employment or engagement ended/i)).toBeVisible()
    expect(within(dialog).getByText(/retain timesheets, approvals, and audit history/i)).toBeVisible()

    await user.click(within(dialog).getByRole("button", { name: "Blocked" }))
    expect(within(dialog).getByText(/security containment/i)).toBeVisible()

    await user.click(within(dialog).getByRole("button", { name: "Not approved" }))
    expect(within(dialog).getByText(/identity, company affiliation, and role are verified/i)).toBeVisible()
  })

  it("opens private patron details and saves an official name without exposing emails in the roster",async()=>{
    const user=await renderAdminPanel()
    const directory=screen.getByRole("heading",{name:/admin user directory/i}).closest("section") as HTMLElement
    expect(directory).not.toHaveTextContent("@example.com")
    const employeeRow=patronRows(directory).find(row=>row.textContent?.includes("employee")) as HTMLElement
    await user.click(within(employeeRow).getByRole("button",{name:"Name not set"}))
    const details=await screen.findByRole("dialog",{name:"Name not set"})
    expect(details).toHaveTextContent("employee@example.com")
    expect(details).toHaveTextContent("TN-000001")
    expect(details).toHaveTextContent("TN-internal-employee")
    await user.click(within(details).getByRole("button",{name:"Edit identity"}))
    await user.type(within(details).getByLabelText("Official name"),"Person Updated")
    await user.type(within(details).getByLabelText("Company-issued ID"),"COMP-42")
    await user.click(within(details).getByRole("button",{name:"Save changes"}))
    await waitFor(()=>expect(details).toHaveTextContent("Person Updated"))
    expect(details).toHaveTextContent("COMP-42")
    expect(fetchCalls.find(call=>call.url==="/tanovo-time/api/people"&&call.method==="PATCH")?.body).toEqual({email:"employee@example.com",officialName:"Person Updated",employeeId:"COMP-42"})
  })
})
