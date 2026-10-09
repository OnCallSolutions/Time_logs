/**
 * Exercises the role-aware timesheet shell at the component boundary.
 *
 * Child widgets are mocked so these tests can focus on the admin directory:
 * seniority ordering and the required Edit -> modal choices -> Save workflow.
 */
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TimesheetApp } from "@/components/timesheet-app"
import { resolvePermissions } from "@/lib/permissions"

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
    if (url === "/tanovotime/api/permissions") return jsonResponse({role:"admin",permissions:resolvePermissions("admin")})
    fetchCalls.push({ url, method, body })

    if (url === "/tanovotime/api/entries") {
      return jsonResponse({ entries: [] })
    }

    if (url === "/tanovotime/api/users" && method === "GET") {
      return jsonResponse({ users: adminUsers })
    }

    if (url === "/tanovotime/api/users" && method === "PATCH") {
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

    if (url === "/tanovotime/api/audit?limit=25") {
      return jsonResponse({ events: [] })
    }

    return jsonResponse({ error: `Unhandled test URL: ${url}` }, 404)
  })

  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/**
 * Renders the app and opens the admin tab.
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

  await user.click(await screen.findByRole("button", { name: /admin/i }))
  await user.click(await screen.findByRole("button", { name: "User directory" }))
  await screen.findByRole("heading", { name: /admin user directory/i })

  return user
}

describe("TimesheetApp admin directory", () => {
  beforeEach(() => {
    fetchCalls.length = 0
    vi.restoreAllMocks()
    mockTimesheetFetch()
  })

  it("orders visible people by descending seniority", async () => {
    await renderAdminPanel()

    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")

    expect(directory).not.toBeNull()

    const rows = within(directory as HTMLElement).getAllByRole("row").slice(1)

    expect(rows[0]).toHaveTextContent("admin@example.com")
    expect(rows[1]).toHaveTextContent("manager@example.com")
    expect(rows[2]).toHaveTextContent("employee@example.com")
  })

  it("saves role and permission changes only from the edit dialog", async () => {
    const user = await renderAdminPanel()
    const directory = screen
      .getByRole("heading", { name: /admin user directory/i })
      .closest("section")
    const rows = within(directory as HTMLElement).getAllByRole("row").slice(1)
    const employeeRow = rows.find((row) =>
      row.textContent?.includes("employee@example.com"),
    )

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
      name: /edit employee access/i,
    })

    await user.click(within(dialog).getByRole("button", { name: /^manager$/i }))
    await user.click(within(dialog).getByRole("button", { name: /^blocked$/i }))
    await user.type(
      within(dialog).getByLabelText(/administrator note/i),
      "Needs review",
    )
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }))

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /edit employee access/i }),
      ).not.toBeInTheDocument()
    })

    const patchCall = fetchCalls.find(
      (call) => call.url === "/tanovotime/api/users" && call.method === "PATCH",
    )

    expect(patchCall?.body).toEqual({
      email: "employee@example.com",
      role: "manager",
      accessStatus: "blocked",
      note: "Needs review",
      permissions: {},
    })
  })
})
