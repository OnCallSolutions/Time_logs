/**
 * Defines the three top-level command groups in the technology admin dashboard.
 * Each button opens a focused subcommand window managed by the parent panel.
 */
"use client"
import { BarChart3, ShieldCheck, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Renders the admin dashboard's Admin, Reports, and Timesheets command groups.
 * @param props.onAdmin - Opens patron, rights, lifecycle, and security controls.
 * @param props.onReports - Opens log, analytics, and activity report choices.
 * @param props.onTimesheets - Opens timesheet tracking controls.
 * @returns JSX.Element containing only the three admin dashboard commands.
 */
export function AdminWorkspace({ activeSection, onAdmin, onReports, onTimesheets }: {
  activeSection: "admin" | "reports" | "timesheets" | null
  onAdmin: () => void
  onReports: () => void
  onTimesheets: () => void
}) {
  return <nav aria-label="Admin dashboard commands" className="admin-command-canvas flex min-h-12 w-full flex-wrap items-center gap-1 border-y border-sky-200 px-1 py-1 text-slate-950">
    <Button aria-current={activeSection === "admin" ? "page" : undefined} variant="ghost" className="feature-control min-h-10 min-w-24 flex-1 justify-center border-transparent px-3 text-sky-950" data-feature="access" onClick={onAdmin}>
      <ShieldCheck className="size-4" />Admin
    </Button>
    <Button aria-current={activeSection === "reports" ? "page" : undefined} variant="ghost" className="feature-control min-h-10 min-w-24 flex-1 justify-center border-transparent px-3 text-orange-950" data-feature="reports" onClick={onReports}>
      <BarChart3 className="size-4" />Reports
    </Button>
    <Button aria-current={activeSection === "timesheets" ? "page" : undefined} variant="ghost" className="feature-control min-h-10 min-w-24 flex-1 justify-center border-transparent px-3 text-sky-950" data-feature="timesheets" onClick={onTimesheets}>
      <Timer className="size-4" />Timesheets
    </Button>
  </nav>
}
