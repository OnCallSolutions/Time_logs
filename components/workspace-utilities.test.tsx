/**
 * Tests accessible utility navigation and bounded unread counters.
 * Cases protect the messaging entry point without a live account or inbox.
 */
import { render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect,it,vi } from "vitest"
import { WorkspaceUtilities } from "./workspace-utilities"

it("opens messages from utility navigation",async()=>{
  const open=vi.fn();render(<WorkspaceUtilities unread={2} onMessages={open}/>)
  expect(screen.getByRole("navigation",{name:"Workspace utilities"})).toBeVisible()
  await userEvent.click(screen.getByRole("button",{name:"Messages, 2 unread"}))
  expect(open).toHaveBeenCalledOnce()
})

it("bounds the badge without losing the accessible count",()=>{
  render(<WorkspaceUtilities unread={125} onMessages={()=>{}}/>)
  expect(screen.getByText("99+")).toBeVisible()
  expect(screen.getByRole("button",{name:"Messages, 125 unread"})).toBeVisible()
})
it("shows zero unread messages without a floating navigation rail",()=>{
  render(<WorkspaceUtilities unread={0} onMessages={()=>{}}/>)
  expect(screen.getByText("0")).toBeVisible()
  expect(screen.getByRole("button",{name:"Messages, 0 unread"})).toBeVisible()
  expect(screen.getByRole("navigation")).not.toHaveClass("fixed")
})
