import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { SubmissionDeadlineSettings } from "./submission-deadline-settings"

afterEach(() => vi.unstubAllGlobals())

it("requires confirmation before creating a period and refreshes after the server accepts it", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ periods: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ period: { name: "October 2026" } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ periods: [{ id: "p1", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", submissionDeadline: "2026-11-02T17:00:00.000Z", managerGraceDays: 3, reminderDays: 3 }] })))
  vi.stubGlobal("fetch", fetch)
  render(<SubmissionDeadlineSettings />)
  await screen.findByText(/No periods configured yet/)
  const user = userEvent.setup()
  await user.type(screen.getByRole("textbox", { name: "Timesheet period name" }), "October 2026")
  await user.type(screen.getByLabelText("Period start date"), "2026-10-01")
  await user.type(screen.getByLabelText("Period end date"), "2026-10-31")
  await user.type(screen.getByLabelText("Period submission deadline"), "2026-11-02T12:00")
  await user.click(screen.getByRole("button", { name: "Create period" }))
  const dialog = screen.getByRole("dialog", { name: "Confirm timesheet period" })
  expect(fetch).toHaveBeenCalledTimes(1)
  await user.click(within(dialog).getByRole("button", { name: "Confirm period" }))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("October 2026 was configured."))
  const payload = JSON.parse(fetch.mock.calls[1][1]?.body as string)
  expect(payload).toMatchObject({ name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", managerGraceDays: 3, reminderDays: 3 })
  expect(fetch).toHaveBeenCalledTimes(3)
})

it("closes the confirmation without creating a period when cancelled", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ periods: [] })))
  vi.stubGlobal("fetch", fetch)
  render(<SubmissionDeadlineSettings />)
  await screen.findByText(/No periods configured yet/)
  const user = userEvent.setup()
  await user.type(screen.getByRole("textbox", { name: "Timesheet period name" }), "October 2026")
  await user.type(screen.getByLabelText("Period start date"), "2026-10-01")
  await user.type(screen.getByLabelText("Period end date"), "2026-10-31")
  await user.type(screen.getByLabelText("Period submission deadline"), "2026-11-02T12:00")
  await user.click(screen.getByRole("button", { name: "Create period" }))
  await user.click(within(screen.getByRole("dialog", { name: "Confirm timesheet period" })).getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})
