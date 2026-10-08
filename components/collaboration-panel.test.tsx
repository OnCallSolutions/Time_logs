/**
 * Verifies compact collaboration landing views without changing authorization.
 * Message bodies and composition stay expandable, while rights require Edit.
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
      ? { users: [{ email: "employee@example.com", permissions: resolvePermissions("employee") }] }
      : { messages: [{ id: "one", sender_email: "manager@example.com", recipient_email: null, body: "Review this entry. ".repeat(20), created_at: "2026-10-08T12:00:00Z" }] }
  ), { headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

it("keeps composition and full messages collapsed until requested", async () => {
  mockRequests()
  render(<MessagesPanel canSend />)
  const compose = screen.getByText("New message").closest("details")!
  expect(compose).not.toHaveAttribute("open")
  await waitFor(() => expect(screen.getByText("manager@example.com → All employees")).toBeInTheDocument())
  expect(screen.getByText("manager@example.com → All employees").closest("details")).not.toHaveAttribute("open")
  await userEvent.click(screen.getByText("New message"))
  expect(compose).toHaveAttribute("open")
})

it("shows rights controls only after Edit without saving on selection", async () => {
  const requests = mockRequests()
  render(<EmployeeRightsPanel permissions={resolvePermissions("admin")} />)
  await screen.findByRole("option", { name: "employee@example.com" })
  await userEvent.selectOptions(screen.getByRole("combobox"), "employee@example.com")
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(screen.getByText("Current rights").closest("details")).not.toHaveAttribute("open")
  await userEvent.click(screen.getByRole("button", { name: "Edit rights" }))
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
  expect(screen.getByRole("button", { name: "Save rights" })).toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(1)
})
