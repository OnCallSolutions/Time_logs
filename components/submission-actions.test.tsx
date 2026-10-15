/**
 * Verifies explicit submission confirmation and AI-only preparation boundaries.
 * Synthetic selections exercise full selection batching and truthful partial failure.
 * No real AI credentials, accounts, or database records are required.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { SubmissionActions } from "./submission-actions"
import type { TimeEntry } from "@/lib/types"
const entries: TimeEntry[] = Array.from({ length: 2 }, (_, index) => ({ id: String(index), revision: "original", ownerEmail: "own@example.com", contractor: "Own", date: "2026-10-15", project: "Delivery", description: `Task ${index}`, hours: 2, status: "draft" }))
afterEach(() => vi.unstubAllGlobals())
beforeEach(()=>vi.stubGlobal("fetch",vi.fn(async()=>Response.json({managers:[{email:"manager@example.com"}]}))))

it("does not submit until confirmation and cancellation makes no changes", async () => {
  const submit = vi.fn()
  render(<SubmissionActions entries={entries} onStatusChange={submit} onSubmitted={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "Submit selected (2)" }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole("heading", { name: "Manager review" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(submit).not.toHaveBeenCalled()
})
it("submits each confirmed record with its selected revision", async () => {
  const submit = vi.fn().mockResolvedValue(undefined), completed = vi.fn()
  render(<SubmissionActions entries={entries} destination="account_manager" onStatusChange={submit} onSubmitted={completed} />)
  await userEvent.click(screen.getByRole("button", { name: "Submit selected (2)" }))
  expect(screen.getByRole("heading", { name: "Account-manager review" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "Confirm submission (2)" }))
  expect(submit).toHaveBeenCalledTimes(2)
  expect(submit).toHaveBeenCalledWith("0", "submitted", undefined, "original")
  expect(completed).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
it("keeps only unconfirmed rows after a partial failure", async () => {
  const submit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Evidence changed."))
  render(<SubmissionActions entries={entries} onStatusChange={submit} onSubmitted={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "Submit selected (2)" }))
  await userEvent.selectOptions(screen.getByLabelText("Reviewing manager"),"manager@example.com")
  await userEvent.click(screen.getByRole("button", { name: "Confirm submission (2)" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence changed")
  expect(screen.getByText(/1 remaining.*1 submitted/)).toBeVisible()
  expect(screen.queryByText("Task 0")).not.toBeInTheDocument()
  expect(screen.getByText("Task 1")).toBeVisible()
  submit.mockResolvedValueOnce(undefined)
  await userEvent.click(screen.getByRole("button", { name: "Confirm submission (1)" }))
  expect(submit).toHaveBeenCalledTimes(3)
  expect(submit.mock.calls[2][0]).toBe("1")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
it("analyzes all 51 selected rows in bounded requests and never submits automatically", async () => {
  const records = Array.from({ length: 51 }, (_, index) => ({ ...entries[0], id: String(index) }))
  const submit = vi.fn()
  const request = vi.fn(async (_url: string, init: RequestInit = {}) => {
    if(!init.method)return Response.json({managers:[{email:"manager@example.com"}]})
    const batch = JSON.parse(init.body as string).selection
    return Response.json({ items: batch.map((item: { id: string; revision: string }) => ({ entryId: item.id, revision: item.revision, readiness: "ready", reason: "Prepared" })) })
  })
  vi.stubGlobal("fetch", request)
  render(<SubmissionActions entries={records} onStatusChange={submit} onSubmitted={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "AI prepare selected (51)" }))
  await userEvent.selectOptions(screen.getByLabelText("Reviewing manager"),"manager@example.com")
  expect(await screen.findByRole("button", { name: "Confirm submission (51)" })).toBeEnabled()
  const batches=request.mock.calls.filter(call=>call[1]?.method==="POST")
  expect(batches).toHaveLength(2)
  expect(JSON.parse(batches[0][1]!.body as string).selection).toHaveLength(50)
  expect(JSON.parse(batches[1][1]!.body as string).selection).toHaveLength(1)
  expect(submit).not.toHaveBeenCalled()
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
  expect(submit).not.toHaveBeenCalled()
})
it("prevents confirmation when selected evidence changes while the window is open", async () => {
  const submit = vi.fn(), props = { entries, onStatusChange: submit, onSubmitted: vi.fn() }
  const { rerender } = render(<SubmissionActions {...props} />)
  await userEvent.click(screen.getByRole("button", { name: "Submit selected (2)" }))
  rerender(<SubmissionActions {...props} entries={[{ ...entries[0], revision: "new" }, entries[1]]} />)
  expect(screen.getByRole("alert")).toHaveTextContent("Selection changed")
  expect(screen.getByRole("button", { name: "Confirm submission (2)" })).toBeDisabled()
  expect(submit).not.toHaveBeenCalled()
})

it("allows canceling read-only AI preparation without submitting any entries", async () => {
  const submit = vi.fn()
  const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
  }))
  vi.stubGlobal("fetch", request)
  render(<SubmissionActions entries={entries} onStatusChange={submit} onSubmitted={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "AI prepare selected (2)" }))
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled()
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(request.mock.calls[0][1].signal?.aborted).toBe(true)
  expect(submit).not.toHaveBeenCalled()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
