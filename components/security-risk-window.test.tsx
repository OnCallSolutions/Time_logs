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
  const fetchMock = vi.fn(async (input:RequestInfo|URL) => new Response(JSON.stringify(String(input).includes("timesheet-periods")?{periods:[{id:"period-1",name:"October period",startDate:"2026-10-01",endDate:"2026-10-31"}]}:{ reports: [{
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
  await user.click(screen.getByRole("button",{name:"Back"}))
  await user.selectOptions(screen.getByRole("combobox",{name:"Severity"}), "low")
  expect(screen.getByText("No reports match this severity.")).toBeInTheDocument()
  await user.selectOptions(screen.getByRole("combobox",{name:"Severity"}), "all")
  expect(screen.getByRole("combobox",{name:"Group security reports by",hidden:true})).not.toBeVisible()
  await user.click(screen.getByText("View options"))
  await user.selectOptions(screen.getByRole("combobox",{name:"Group security reports by"}),"period")
  expect(screen.getByText(/October period/)).toBeVisible()
  await user.type(screen.getByRole("searchbox",{name:"Search security reports"}),"failed sign-ins")
  expect(screen.getByText("Review failed sign-ins.")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Refresh security reports" }))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/security")).length).toBe(2))
  for (const [, options] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
    expect(options.method).toBeUndefined()
  }
})
