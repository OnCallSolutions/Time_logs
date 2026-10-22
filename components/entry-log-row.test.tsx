import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { EntryLogRow } from "./entry-log-row"
import type { TimeEntry } from "@/lib/types"

const entry: TimeEntry = { id: "123e4567-e89b-42d3-a456-426614174000", revision: "rev-3", contractor: "Casey", project: "Build", date: "2026-10-10", hours: 4, description: "Install equipment", status: "draft" }

it("saves explicit edits and keeps all mutations behind their intended controls", async () => {
  const onUpdate = vi.fn(), onStatusChange = vi.fn(), onDelete = vi.fn(), onReview = vi.fn()
  const user = userEvent.setup()
  const { container, rerender } = render(<table><tbody><EntryLogRow entry={entry} showIdentity canEdit canDelete canSubmit canRecall canReview={false} onUpdate={onUpdate} onStatusChange={onStatusChange} onDelete={onDelete} onReview={onReview} /></tbody></table>)
  await user.click(screen.getByRole("button", { name: "Edit entry" }))
  await user.clear(screen.getByRole("textbox", { name: "Description" }))
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Install and verify equipment")
  await user.click(screen.getByRole("button", { name: "Save entry" }))
  expect(onUpdate).toHaveBeenCalledWith(entry.id, expect.objectContaining({ description: "Install and verify equipment", hours: 4 }), "rev-3")
  expect(onDelete).not.toHaveBeenCalled()
  expect(onStatusChange).not.toHaveBeenCalled()

  await user.click(screen.getByRole("button", { name: "Submit entry" }))
  expect(onStatusChange).toHaveBeenCalledWith(entry.id, "submitted", undefined, "rev-3")

  const submitted = { ...entry, status: "submitted" as const }
  rerender(<table><tbody><EntryLogRow entry={submitted} showIdentity canEdit={false} canDelete canSubmit={false} canRecall canReview={false} onUpdate={onUpdate} onStatusChange={onStatusChange} onDelete={onDelete} onReview={onReview} /></tbody></table>)
  await user.click(screen.getByRole("button", { name: "Recall entry to draft" }))
  expect(onStatusChange).toHaveBeenLastCalledWith(entry.id, "draft", undefined, "rev-3")
  await user.click(screen.getByRole("button", { name: "Delete entry" }))
  const dialog = screen.getByRole("dialog", { name: "Confirm entry deletion" })
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  expect(onDelete).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "Delete entry" }))
  await user.click(within(screen.getByRole("dialog", { name: "Confirm entry deletion" })).getByRole("button", { name: "Delete entry" }))
  expect(onDelete).toHaveBeenCalledWith(entry.id)
  expect(container).toBeInTheDocument()
})

it("disables approval when the server marks a submitted row ineligible", () => {
  render(<table><tbody><EntryLogRow entry={{ ...entry, status: "submitted", approvalEligible: false }} showIdentity canEdit={false} canDelete={false} canSubmit={false} canReview onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onReview={vi.fn()} /></tbody></table>)
  expect(screen.getByRole("button", { name: "Approve entry" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Reject entry" })).toBeEnabled()
})

it("shows the assigned approving manager alongside the timesheet owner",()=>{
  render(<table><tbody><EntryLogRow entry={{...entry,reviewManagerEmail:"manager@example.com",reviewManagerName:"Maurice Baraza"}} showIdentity canEdit={false} canDelete={false} canSubmit={false} canReview={false} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onReview={vi.fn()}/></tbody></table>)
  expect(screen.getByText("Casey")).toBeVisible()
  expect(screen.getByText("Approver: Maurice Baraza")).toBeVisible()
})
