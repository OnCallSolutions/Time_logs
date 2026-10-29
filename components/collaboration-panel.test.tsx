/**
 * Verifies compact collaboration landing views without changing authorization.
 * Composition and rights use isolated windows opened by explicit buttons.
 * Mock endpoints keep these checks independent of accounts and production data.
 */
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { EmployeeRightsPanel, MessagesPanel } from "./collaboration-panel"
import { resolvePermissions } from "@/lib/permissions"

afterEach(() => vi.unstubAllGlobals())

/**
 * Supplies isolated roster and inbox responses for compact-view tests.
 * @returns Mock fetch function for asserting that reading never saves changes.
 */
function mockRequests() {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("delegation")
      ? { users: [{ email: "employee@example.com", displayName:"Employee Person",companyReference:"TN-000001",role:"employee",accessStatus:"active",permissions: resolvePermissions("employee") },{email:"admin@example.com",displayName:"Admin Person",companyReference:"TN-000002",role:"admin",accessStatus:"active",permissions:resolvePermissions("admin")},{email:"manager@example.com",displayName:"Manager Person",companyReference:"TN-000003",role:"manager",accessStatus:"active",permissions:resolvePermissions("manager")}] }
      : { messages: [{ id: "one", sender_email: "manager@example.com", recipient_email: null, body: "Review this entry. ".repeat(20), created_at: "2026-10-08T12:00:00Z" }] }
  ), { headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

it("opens message composition in a full-screen window", async () => {
  mockRequests()
  render(<MessagesPanel canSend />)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button",{name:/Announcements/})).toBeInTheDocument())
  await userEvent.click(screen.getByText("New message"))
  expect(screen.getByRole("dialog",{name:"New message"})).toHaveAttribute("data-window-expanded","true")
})

it("shows rights controls only after Edit without saving on selection", async () => {
  const requests = mockRequests()
  render(<EmployeeRightsPanel permissions={resolvePermissions("admin")} />)
  await screen.findByText("Employee Person")
  expect(screen.getByText("Admin Person")).toBeInTheDocument()
  expect(screen.getByText("Manager Person")).toBeInTheDocument()
  expect(screen.getByText("employee · 1")).toBeInTheDocument()
  expect(screen.getByText("manager · 1")).toBeInTheDocument()
  expect(screen.queryByText("employee@example.com")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Employee Person"}))
  expect(screen.getByRole("dialog",{name:"Employee Person"})).toHaveTextContent("employee@example.com")
  await userEvent.click(within(screen.getByRole("dialog",{name:"Employee Person"})).getByRole("button",{name:"Back"}))
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Edit rights for Admin Person"})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Edit rights for Employee Person" }))
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
  expect(screen.getByRole("button", { name: "Save rights" })).toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(1)
})
