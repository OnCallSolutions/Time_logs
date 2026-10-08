/**
 * Checks report filtering, evidence disclosure, and read-only security refresh.
 * Synthetic assessments avoid accessing real monitoring or employee records.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { SecurityRiskWindow } from "./security-risk-window"

afterEach(() => vi.unstubAllGlobals())

it("filters severity and refreshes stored reports without starting analysis", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reports: [{
    run_day: "2026-10-08", status: "completed", event_count: 8, possibly_truncated: false,
    completed_at: "2026-10-08T12:00:00Z", assessment: { severity: "high", summary: "Review failed sign-ins.",
      findings: [{ eventIds: ["event-one"], explanation: "Repeated failed sign-ins", recommendation: "Review account access." }] },
  }] }), { headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  render(<SecurityRiskWindow onClose={vi.fn()} />)
  await screen.findByText("Review failed sign-ins.")
  const user = userEvent.setup()
  expect(screen.getByRole("dialog")).toHaveAttribute("data-window-expanded", "true")
  await user.click(screen.getByText("Finding 1: Repeated failed sign-ins"))
  expect(screen.getByText("Evidence: event-one")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox"), "low")
  expect(screen.getByText("No reports match this severity.")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Refresh security reports" }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  for (const [, options] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
    expect(options.method).toBeUndefined()
  }
})
