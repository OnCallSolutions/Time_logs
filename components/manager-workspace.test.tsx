/**
 * Verifies that manager review decisions require explicit confirmation.
 * Rejection reasons and cancellation are exercised without a live API.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { EntryReviewDialog } from "./manager-workspace"
const entry = {id:"1",contractor:"Employee",date:"2026-10-07",hours:8,project:"Delivery",description:"Project work",status:"submitted" as const}
it("requires a rejection reason and confirms the decision", async () => {
  const confirm = vi.fn()
  render(<EntryReviewDialog entry={entry} decision="rejected" onCancel={vi.fn()} onConfirm={confirm} />)
  expect(screen.getByRole("button",{name:"Reject entry"})).toBeDisabled()
  await userEvent.type(screen.getByLabelText("Rejection reason"), "Incorrect hours")
  expect(confirm).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Reject entry"}))
  expect(confirm).toHaveBeenCalledWith("Incorrect hours")
})
it("cancels approval without making a decision", async () => {
  const confirm = vi.fn(), cancel = vi.fn()
  render(<EntryReviewDialog entry={entry} decision="approved" onCancel={cancel} onConfirm={confirm} />)
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}))
  expect(cancel).toHaveBeenCalledOnce()
  expect(confirm).not.toHaveBeenCalled()
})
