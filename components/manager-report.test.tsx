/**
 * Covers the report's filtering, grouping, sorting, and view-mode controls.
 * These behaviors keep summary totals and detailed rows aligned for reviewers.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"
import type { TimeEntry } from "@/lib/types"
import { ManagerReport } from "./manager-report"

const entries: TimeEntry[] = [
  {
    id: "entry-1",
    contractor: "Alex Morgan",
    date: "2026-10-14",
    hours: 6,
    project: "Website",
    description: "Reviewed landing page",
    status: "submitted",
    reviewNote: "Waiting on approval",
  },
  {
    id: "entry-2",
    contractor: "Alex Morgan",
    date: "2026-10-15",
    hours: 2,
    project: "Mobile app",
    description: "Fixed navigation",
    status: "approved",
  },
  {
    id: "entry-3",
    contractor: "Sam Lee",
    date: "2026-10-15",
    hours: 4,
    project: "Website",
    description: "Added accessibility tests",
    status: "draft",
  },
]

/**
 * Renders a report with deterministic fixture data.
 * @returns The mounted report and its accessible controls.
 */
function setup() {
  return render(<ManagerReport entries={entries} />)
}

it("summarizes hours by contractor and changes the grouping on selection", async () => {
  const user = userEvent.setup()
  setup()

  const summary = screen.getByRole("region", { name: "Hours by contractor" })
  expect(within(summary).getByText("Alex Morgan", { selector: "span" })).toBeVisible()
  expect(within(summary).getByText("8h", { exact: false })).toBeVisible()

  await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "project")
  expect(screen.getByRole("region", { name: "Hours by project" })).toBeVisible()
  expect(within(screen.getByRole("region", { name: "Hours by project" })).getByText("Mobile app", { selector: "span" })).toBeVisible()
  expect(within(screen.getByRole("region", { name: "Hours by project" })).getByText("Website", { selector: "span" })).toBeVisible()
})

it("searches across report details and keeps totals filtered", async () => {
  const user = userEvent.setup()
  setup()

  await user.type(screen.getByPlaceholderText("Search names, projects, notes…"), "approval")

  const controls = screen.getByRole("region", { name: "Report controls" })
  expect(within(controls).getByText(/1 entry/)).toBeVisible()
  expect(within(controls).getByText(/Oct 14, 2026/)).toBeVisible()
  expect(screen.getByRole("region", { name: "Hours by contractor" })).toHaveTextContent("Alex Morgan")
  expect(screen.getByRole("region", { name: "Hours by contractor" })).not.toHaveTextContent("Sam Lee")
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeEnabled()

  await user.click(screen.getByRole("button", { name: "Clear filters" }))
  expect(within(controls).getByText(/3 entries/)).toBeVisible()
})

it("shows grouped compact detail rows and applies the chosen sort", async () => {
  const user = userEvent.setup()
  setup()

  await user.click(screen.getByRole("button", { name: "Entries" }))
  await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "project")
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "hours_asc")

  const report = screen.getByRole("region", { name: "Detailed report entries" })
  expect(within(report).getByText("Mobile app", { selector: "th" })).toBeVisible()
  expect(within(report).getByText("Website", { selector: "th" })).toBeVisible()
  const rows = within(report).getAllByRole("row")
  expect(rows[1]).toHaveTextContent("Mobile app")
  expect(rows[2]).toHaveTextContent("Alex Morgan")
  expect(rows[3]).toHaveTextContent("Website")
  expect(within(report).getByText("Added accessibility tests")).toBeVisible()
})

it("filters by a date range and groups summary totals by month",async()=>{
  const user=userEvent.setup()
  setup()
  fireEvent.change(screen.getByLabelText("From date"),{target:{value:"2026-10-15"}})
  expect(screen.getByRole("region",{name:"Report controls"})).toHaveTextContent("2 entries")
  await user.selectOptions(screen.getByRole("combobox",{name:"Group by"}),"month")
  expect(screen.getByRole("region",{name:"Hours by month"})).toHaveTextContent("October 2026")
  expect(screen.getByRole("region",{name:"Hours by month"})).toHaveTextContent("6h")
})
