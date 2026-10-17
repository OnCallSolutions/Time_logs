/**
 * Exercises full-screen defaults and nested-window return navigation.
 * Background surfaces must be hidden and inert without losing parent state.
 * These tests use isolated DOM fixtures rather than authenticated accounts.
 */
import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"
import { WindowSurface } from "./window-surface"
import { WindowAssistantProvider } from "./window-assistant-context"

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
  expect(parent).toHaveFocus()
  expect(parent).toHaveAttribute("data-window-expanded", "true")
  expect(parent).toHaveAttribute("data-window-resizable", "true")
  await user.click(screen.getByRole("button", { name: "Restore window" }))
  expect(parent).toHaveAttribute("data-window-expanded", "false")
  const resizeEdge = parent.querySelector<HTMLElement>("[data-resize-edge='se']")
  expect(resizeEdge).not.toBeNull()
  fireEvent.pointerDown(resizeEdge!, { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(resizeEdge!, { pointerId: 1, clientX: 140, clientY: 130 })
  expect(parent.querySelector(".window-content")?.parentElement).toHaveStyle({ width: "280px", height: "240px" })
  fireEvent.pointerUp(resizeEdge!, { pointerId: 1 })
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

it("keeps window AI hidden until its bottom-right assistant button is opened",async()=>{
  render(<WindowAssistantProvider renderAssistant={(workspace,onClose)=><section aria-label="Window AI">AI for {workspace}<button onClick={onClose}>Close contextual AI</button></section>}>
    <WindowSurface title="Reports" onBack={()=>{}}><section>Report workspace</section></WindowSurface>
  </WindowAssistantProvider>)
  expect(screen.queryByRole("region",{name:"Window AI"})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Open Reports AI assistant"}))
  expect(screen.getByRole("region",{name:"Window AI"})).toHaveTextContent("AI for Reports")
  await userEvent.click(screen.getByRole("button",{name:"Close contextual AI"}))
  expect(screen.queryByRole("region",{name:"Window AI"})).not.toBeInTheDocument()
})
