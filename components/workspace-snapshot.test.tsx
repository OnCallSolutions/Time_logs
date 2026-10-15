/**
 * Checks the landing summary's personal/team boundary using synthetic evidence.
 * Counts must reflect the authenticated owner, not a shared display name.
 */
import { render, screen, within } from "@testing-library/react"
import { expect, it } from "vitest"
import { WorkspaceSnapshot } from "./workspace-snapshot"
import type { TimeEntry } from "@/lib/types"
const own: TimeEntry = { id: "own", ownerEmail: "own@example.com", contractor: "Same Name", date: "2026-10-15", project: "Own project", description: "Work", hours: 2, status: "draft" }
const other: TimeEntry = { ...own, id: "other", ownerEmail: "other@example.com", project: "Other project", status: "submitted", reviewEligible: true, hours: 3 }
it("separates managerial personal work from independent review workload", () => {
  render(<WorkspaceSnapshot entries={[own, other]} email="own@example.com" role="manager" loading={false} canReview />)
  const snapshot = screen.getByRole("region", { name: "Workspace snapshot" })
  expect(within(snapshot).getByText("1 entries / 1 projects")).toBeVisible()
  expect(within(snapshot).getByText("Own project")).toBeVisible()
  expect(within(snapshot).queryByText("Other project")).not.toBeInTheDocument()
  expect(within(snapshot).getByText(/awaiting your review/)).toHaveTextContent("1 awaiting your review / 3h")
  expect(within(snapshot).getByText("Review destination: account manager")).toBeVisible()
})
it("does not count or expose other people in personal contractor project activity", () => {
  render(<WorkspaceSnapshot entries={[own, other]} email="own@example.com" role="contractor" loading={false} canReview={false} />)
  expect(screen.queryByText("Other project")).not.toBeInTheDocument()
  expect(screen.queryByText(/awaiting your review/)).not.toBeInTheDocument()
})
