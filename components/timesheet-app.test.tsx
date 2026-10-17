/**
 * Exercises the role-aware timesheet shell at the component boundary.
 *
 * Child widgets are mocked so these tests can focus on the admin directory:
 * seniority ordering and the required Edit -> modal choices -> Save workflow.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
  EntriesLog: () => <div data-testid="entries-log" />,
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
function mockTimesheetFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (url === "/tanovo-time/api/permissions") return jsonResponse({role:"admin",permissions:resolvePermissions("admin")})
    fetchCalls.push({ url, method, body })

    if (url === "/tanovo-time/api/entries") {
      return jsonResponse({ entries: [] })
    }

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
      return jsonResponse({ identity: { email: body.email, officialName: "Person Updated", shortReference: "TN-000001", contractorNumber: "TN-internal-employee" } })
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

describe("TimesheetApp admin directory", () => {
  beforeEach(() => {
    fetchCalls.length = 0
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    mockTimesheetFetch()
  })

  it("orders people by descending seniority without exposing account identifiers in the roster", async () => {
    await renderAdminPanel()

    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")

    expect(directory).not.toBeNull()

    const rows = within(directory as HTMLElement).getAllByRole("row").slice(1)

    expect(rows[0]).toHaveTextContent("Name not set")
    expect(rows[0]).toHaveTextContent("admin")
    expect(rows[1]).toHaveTextContent("manager")
    expect(rows[2]).toHaveTextContent("employee")
    expect(directory).not.toHaveTextContent("TN-")
    expect(directory).not.toHaveTextContent("@example.com")
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
    expect(within(activity).getByText("Distinct actors")).toBeVisible()
    expect(within(activity).getByText("entry approved")).toHaveClass("bg-emerald-50")
    expect(within(activity).getByText("time entry")).toHaveClass("bg-blue-50")
    expect(within(activity).getByText("/tanovo-time/api/entries/entry-1")).toBeVisible()
    expect(within(activity).queryByText("203.0.113.10")).not.toBeInTheDocument()

    await user.click(within(activity).getByRole("row", { name: /admin@example.com entry approved/i }))
    const details = await screen.findByRole("dialog", { name: "Activity detail" })
    expect(within(details).getByText("203.0.113.10")).toBeVisible()
    expect(within(details).getByText(/fromStatus/)).toBeVisible()
    expect(within(details).getByText("req-test-1")).toBeVisible()
  })

  it("uses the admin landing area to find people and resolve access issues", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))

    const roster = screen.getByRole("region", { name: "People and access" })
    expect(within(roster).getByRole("heading", { name: "People and access" })).toBeVisible()
    expect(roster).toHaveTextContent("Resolve identity, access, and account health issues")
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
    expect(within(timesheets).getByRole("heading", { name: "Timesheet workbench" })).toBeVisible()
    expect(within(timesheets).getByTestId("entries-log")).toBeInTheDocument()
    expect(within(timesheets).getByRole("button", { name: "Log time" })).toBeVisible()
    expect(within(timesheets).getByRole("heading", { name: "Prepare and send for approval" })).toBeVisible()
    expect(within(timesheets).getByRole("button", { name: "AI suggestions" })).toBeVisible()
    expect(within(timesheets).getByRole("button", { name: "Refresh entries" })).toBeVisible()
    await user.click(within(timesheets).getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("navigation", { name: "Admin dashboard commands" })).getByRole("button", { name: "Reports" }))
    const reportsAgain = await screen.findByRole("dialog", { name: "Reports" })
    await user.click(within(reportsAgain).getByRole("button", { name: "Open analytics report" }))
    const analyticsReport = await screen.findByRole("dialog", { name: "Analytics reports" })
    expect(within(analyticsReport).getByTestId("manager-report")).toBeInTheDocument()
  })

  it("keeps one assistant dock and focuses its composer from the header shortcut", async () => {
    const user = await renderAdminPanel()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(within(screen.getByRole("dialog", { name: "Admin" })).getByRole("button", { name: "Back" }))

    const assistant = screen.getByRole("region", { name: "DevOnCall assistant" })
    expect(assistant).toBeInTheDocument()
    expect(within(assistant).getByRole("heading", { name: "DevOnCall" })).toBeVisible()
    const mainAssistant = screen.getByRole("region", { name: "DevOnCall assistant" })
    const composer = within(mainAssistant).getByLabelText("Ask DevOnCall")
    await user.click(screen.getByRole("button", { name: "Go to DevOnCall assistant" }))
    await waitFor(() => expect(composer).toHaveFocus())
    expect(within(mainAssistant).getByText("Tanovo Time · Workspace questions and actions")).toBeVisible()
    expect(screen.getAllByRole("region", { name: "DevOnCall assistant" })).toHaveLength(1)
  })

  it("saves role and permission changes only from the edit dialog", async () => {
    const user = await renderAdminPanel()
    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")
    const rows = within(directory as HTMLElement).getAllByRole("row").slice(1)
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
    expect(within(dialog).getByLabelText("Export visible timesheets")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Account manager" }).parentElement).toHaveClass("role-choice-grid")
    await user.click(within(dialog).getByRole("button", { name: "Restore window" }))
    const resizeEdge = dialog.querySelector('[data-resize-edge="e"]') as HTMLElement
    fireEvent.pointerDown(resizeEdge, { pointerId: 7, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(resizeEdge, { pointerId: 7, clientX: 120, clientY: 100 })
    fireEvent.pointerUp(resizeEdge, { pointerId: 7, clientX: 120, clientY: 100 })
    expect(dialog.querySelector(":scope > div") as HTMLElement).toHaveStyle({ width: "280px" })

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
    const employeeRow = within(directory).getAllByRole("row").slice(1).find(row => row.textContent?.includes("employee")) as HTMLElement
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
    const employeeRow = within(directory as HTMLElement).getAllByRole("row").slice(1).find(row => row.textContent?.includes("employee"))
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
    const employeeRow = within(directory as HTMLElement).getAllByRole("row").slice(1).find(row => row.textContent?.includes("employee"))
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
    const employeeRow=within(directory).getAllByRole("row").slice(1).find(row=>row.textContent?.includes("employee")) as HTMLElement
    await user.click(within(employeeRow).getByRole("button",{name:"Name not set"}))
    const details=await screen.findByRole("dialog",{name:"Name not set"})
    expect(details).toHaveTextContent("employee@example.com")
    expect(details).toHaveTextContent("TN-000001")
    expect(details).toHaveTextContent("TN-internal-employee")
    await user.click(within(details).getByRole("button",{name:"Edit name"}))
    await user.type(within(details).getByLabelText("Official name"),"Person Updated")
    await user.click(within(details).getByRole("button",{name:"Save name"}))
    await waitFor(()=>expect(details).toHaveTextContent("Person Updated"))
    expect(fetchCalls.find(call=>call.url==="/tanovo-time/api/people"&&call.method==="PATCH")?.body).toEqual({email:"employee@example.com",officialName:"Person Updated"})
  })
})
