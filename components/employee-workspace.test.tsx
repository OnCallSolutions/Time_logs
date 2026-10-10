/**
 * Verifies employee workflow shortcuts without depending on a live database.
 * Tests assert that correction selection changes only the local view filter.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { EmployeeWorkspace } from "./employee-workspace"

it("selects corrections without offering team or admin actions", async () => {
  const select = vi.fn()
  render(<EmployeeWorkspace entries={[]} selected="all" onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /needs correction/i }))
  expect(select).toHaveBeenCalledWith("rejected")
  expect(screen.queryByRole("button", {name: /approve entry|security|employee access/i})).not.toBeInTheDocument()
})
