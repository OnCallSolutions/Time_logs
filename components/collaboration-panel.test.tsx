/**
 * Verifies compact collaboration landing views without changing authorization.
 * Composition and rights use isolated windows opened by explicit buttons.
 * Mock endpoints keep these checks independent of accounts and production data.
 */
import { render, screen, waitFor } from "@testing-library/react"
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
      ? { users: [{ email: "employee@example.com", role:"employee",accessStatus:"active",permissions: resolvePermissions("employee") },{email:"admin@example.com",role:"admin",accessStatus:"active",permissions:resolvePermissions("admin")},{email:"manager@example.com",role:"manager",accessStatus:"active",permissions:resolvePermissions("manager")}] }
      : { messages: [{ id: "one", sender_email: "manager@example.com", recipient_email: null, body: "Review this entry. ".repeat(20), created_at: "2026-10-08T12:00:00Z" }] }
  ), { headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

it("opens message composition in a full-screen window", async () => {
  mockRequests()
  render(<MessagesPanel canSend />)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByText("manager@example.com → All employees")).toBeInTheDocument())
  await userEvent.click(screen.getByText("New message"))
  expect(screen.getByRole("dialog",{name:"New message"})).toHaveAttribute("data-window-expanded","true")
})

it("shows rights controls only after Edit without saving on selection", async () => {
  const requests = mockRequests()
  render(<EmployeeRightsPanel permissions={resolvePermissions("admin")} />)
  await screen.findByText("employee@example.com")
  expect(screen.getByText("admin@example.com")).toBeInTheDocument()
  expect(screen.getByText("manager@example.com")).toBeInTheDocument()
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Edit rights for admin@example.com"})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Edit rights for employee@example.com" }))
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
  expect(screen.getByRole("button", { name: "Save rights" })).toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(1)
})
