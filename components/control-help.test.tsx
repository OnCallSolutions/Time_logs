/**
 * Verifies contextual control help without changing existing command behavior.
 * Tests pointer, keyboard, dismissal, and buttons that submit ordinary forms.
 * No live application data, authentication, or mutation endpoints are used.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect,it,vi } from "vitest"
import { Button } from "./ui/button"
import { controlLabel,controlHelp } from "./control-help"
it("describes known commands without inventing unknown behavior",()=>{
  expect(controlLabel(<><span>Review</span><span>queue</span></>)).toBe("Review queue")
  expect(controlHelp("Prepare AI review")).toContain("does not approve")
  expect(controlHelp("Unrecognized command")).toBeUndefined()
})
it("shows contextual help on hover without triggering the command",async()=>{
  const action=vi.fn();render(<Button help="Inspect full entry metadata." onClick={action}>Details</Button>)
  await userEvent.hover(screen.getByRole("button",{name:"Details"}))
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Inspect full entry metadata.")
  expect(action).not.toHaveBeenCalled()
})
it("supports focus, Escape dismissal, and form submission",async()=>{
  const submit=vi.fn();render(<form onSubmit={event=>{event.preventDefault();submit()}}><Button type="submit" help="Save these changes.">Save</Button></form>)
  const user=userEvent.setup();await user.tab()
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Save these changes.")
  await user.keyboard("{Escape}");await waitFor(()=>expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
  await user.click(screen.getByRole("button",{name:"Save"}));expect(submit).toHaveBeenCalledTimes(1)
})
