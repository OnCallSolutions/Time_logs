/**
 * Verifies that technology-manager shortcuts open existing administration tools.
 * Navigation callbacks are exercised without applying role or permission changes.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { AdminWorkspace } from "./admin-workspace"
it("exposes only the three admin dashboard command groups", async () => {
  const admin = vi.fn(), reports = vi.fn(), timesheets = vi.fn()
  render(<AdminWorkspace activeSection={null} onAdmin={admin} onReports={reports} onTimesheets={timesheets} />)
  const commands = screen.getByRole("navigation", { name: "Admin dashboard commands" })
  expect(within(commands).getAllByRole("button").map(button => button.textContent?.trim())).toEqual([
    "Admin", "Reports", "Timesheets",
  ])
  await userEvent.click(within(commands).getByRole("button", { name: "Admin" }))
  await userEvent.click(within(commands).getByRole("button", { name: "Reports" }))
  await userEvent.click(within(commands).getByRole("button", { name: "Timesheets" }))
  expect(admin).toHaveBeenCalledOnce()
  expect(reports).toHaveBeenCalledOnce()
  expect(timesheets).toHaveBeenCalledOnce()
})
