/**
 * Exercises full-screen defaults and nested-window return navigation.
 * Background surfaces must be hidden and inert without losing parent state.
 * These tests use isolated DOM fixtures rather than authenticated accounts.
 */
import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"
import { WindowSurface } from "./window-surface"

/**
 * Builds a parent window with an editable draft and a nested security window.
 * @returns JSX.Element providing reproducible window-history interactions.
 */
function Windows() {
  const [parent, setParent] = useState(false)
  const [child, setChild] = useState(false)
  return <><button onClick={() => setParent(true)}>Open activity</button>
    {parent && <WindowSurface title="Activity" onBack={() => setParent(false)}><section>
      <input aria-label="Draft" defaultValue="Retained draft" />
      <button onClick={() => setChild(true)}>Open security</button>
      {child && <WindowSurface title="Security" onBack={() => setChild(false)}><section>Risk assessment</section></WindowSurface>}
    </section></WindowSurface>}
  </>
}

it("defaults to full screen and restores the previous window and draft with Back", async () => {
  render(<Windows />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Open activity" }))
  const parent = screen.getByRole("dialog", { name: "Activity" })
  expect(parent).toHaveAttribute("data-window-expanded", "true")
  await user.click(screen.getByRole("button", { name: "Restore window" }))
  expect(parent).toHaveAttribute("data-window-expanded", "false")
  await user.click(screen.getByRole("button", { name: "Open security" }))
  expect(parent).not.toBeVisible()
  expect(parent.inert).toBe(true)
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  await user.click(screen.getByRole("button", { name: "Back" }))
  expect(parent).toBeVisible()
  expect(parent.inert).toBe(false)
  expect(screen.getByLabelText("Draft")).toHaveValue("Retained draft")
  expect(parent).toHaveAttribute("data-window-expanded", "false")
  await user.click(screen.getByRole("button", { name: "Back" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Open activity" })).toBeVisible()
})

it("Escape returns from the nested window without dismissing its parent", async () => {
  render(<Windows />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Open activity" }))
  await user.click(screen.getByRole("button", { name: "Open security" }))
  await user.keyboard("{Escape}")
  expect(screen.getByRole("dialog", { name: "Activity" })).toBeVisible()
  expect(screen.queryByRole("dialog", { name: "Security" })).not.toBeInTheDocument()
})
