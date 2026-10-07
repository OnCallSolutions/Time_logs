/**
 * Verifies that technology-manager shortcuts open existing administration tools.
 * Navigation callbacks are exercised without applying role or permission changes.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { AdminWorkspace } from "./admin-workspace"
it("opens directory and AI security reports through explicit buttons", async () => {
  const directory = vi.fn(), security = vi.fn()
  render(<AdminWorkspace onDirectory={directory} onSecurity={security} />)
  expect(directory).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Employee access"}))
  await userEvent.click(screen.getByRole("button",{name:"AI security reports"}))
  expect(directory).toHaveBeenCalledOnce()
  expect(security).toHaveBeenCalledOnce()
})
