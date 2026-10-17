/**
 * Provides personal workflow shortcuts for employees and baseline users.
 * Status buttons filter only the entries already authorized by the server.
 * This component never fetches team records or exposes administrative actions.
 */
"use client"
import { ArrowRight, CheckCircle2, ClipboardList, Clock3, FilePlus2, ListChecks, Send, Users, XCircle } from "lucide-react"
import type { EntryStatus, TimeEntry, UserRole } from "@/lib/types"
import { Button } from "@/components/ui/button"

/**
 * Provides a role-specific workspace home without rendering raw entry rows.
 * Each action leads into the established Timesheets or Reviews command group.
 * @param props.role - Effective role selecting contractor, employee, or manager priorities.
 * @param props.entries - Authorized personal entries used for status summaries.
 * @param props.teamEntries - Authorized team entries used for manager context.
 * @param props.pending - Reviewable submissions visible to this manager.
 * @param props.canCreate - Whether the current role can create time entries.
 * @param props.canReview - Whether the current role can review submitted entries.
 * @param props.canReports - Whether the current role can open team reports.
 * @param props.onTimesheets - Opens the Timesheets command group.
 * @param props.onReviews - Opens the Reviews command group.
 * @param props.onLogTime - Opens the time-entry capture workflow.
 * @returns A compact workspace home tailored to the active role.
 */
export function RoleWorkspaceHome({ role, entries, teamEntries = [], pending, canCreate, canReview, canReports, onTimesheets, onReviews, onLogTime }: {
  role: "contractor" | "employee" | "manager"
  entries: TimeEntry[]
  teamEntries?: TimeEntry[]
  pending: number
  canCreate: boolean
  canReview: boolean
  canReports: boolean
  onTimesheets: () => void
  onReviews: () => void
  onLogTime: () => void
}) {
  const personal = entries
  const isContractor = role === "contractor"
  const isManager = role === "manager"
  const title = isContractor ? "Contractor workspace" : isManager ? "Manager workspace" : "Employee workspace"
  const description = isContractor
    ? "Capture your project hours, keep your own records accurate, and send eligible work to your assigned manager."
    : isManager
      ? "Review team submissions, use AI as an adviser, and move approved contractor work to business accounts. Your own hours go through independent review."
      : "Record internal work, correct your own entries, and submit approved timekeeping records to your manager."

  return <section aria-label={`${role} workspace home`} className={`min-h-[20rem] overflow-auto rounded-lg border p-4 sm:p-6 ${isContractor ? "border-orange-200 bg-gradient-to-br from-orange-50 via-white to-sky-50" : isManager ? "border-blue-200 bg-gradient-to-br from-blue-50 via-white to-orange-50" : "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50"}`}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-current/10 pb-4">
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${isContractor ? "text-orange-800" : isManager ? "text-blue-800" : "text-emerald-800"}`}>{isContractor ? "Project time" : isManager ? "Team operations" : "Internal time"}</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canCreate && <Button onClick={onLogTime} className={isContractor ? "bg-orange-600 text-white hover:bg-orange-700" : undefined}><FilePlus2 className="size-4"/>{isContractor ? "Log project time" : "Log time"}</Button>}
        <Button variant="outline" onClick={onTimesheets}><Clock3 className="size-4"/>{isManager ? "My timesheets" : isContractor ? "My submissions" : "My time entries"}<ArrowRight className="size-4"/></Button>
        {isManager && (canReview || canReports) && <Button variant="outline" onClick={onReviews}><Users className="size-4"/>Team reviews<ArrowRight className="size-4"/></Button>}
      </div>
    </header>

    {isManager ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-orange-200 bg-orange-50 p-3"><p className="text-xs text-orange-900">Awaiting your review</p><p className="mt-1 text-2xl font-semibold tabular-nums text-orange-950">{pending}</p></div>
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-900">Team submissions</p><p className="mt-1 text-2xl font-semibold tabular-nums text-blue-950">{teamEntries.length}</p></div>
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-emerald-900">Review path</p><p className="mt-1 text-sm font-semibold text-emerald-950">Approved contractor time → Business accounts</p></div>
    </div> : <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className={`rounded-md border p-3 ${isContractor ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs text-slate-600">Draft entries</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{personal.filter(entry => entry.status === "draft").length}</p></div>
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-slate-600">Awaiting manager</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{personal.filter(entry => entry.status === "submitted").length}</p></div>
      <div className="rounded-md border border-green-200 bg-green-50 p-3"><p className="text-xs text-slate-600">Approved hours</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{personal.filter(entry => entry.status === "approved").reduce((total, entry) => total + entry.hours, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}h</p></div>
    </div>}
    {isContractor && <p className="mt-4 rounded-md border border-orange-200 bg-white/80 px-3 py-2 text-sm text-orange-950">Only your own database-registered timesheets can be submitted for manager review.</p>}
    {isManager && !canReview && !canReports && <p className="mt-4 rounded-md border border-blue-200 bg-white/80 px-3 py-2 text-sm text-blue-950">Review actions are not currently assigned to your account. Your own timesheets remain available under Timesheets.</p>}
  </section>
}

/**
 * Renders status shortcuts with live counts for personal time entries.
 * @param props.entries - Server-authorized personal records.
 * @param props.selected - Currently selected personal status filter.
 * @param props.onSelect - Callback that selects a status without changing records.
 * @returns JSX.Element with employee workflow controls.
 */
export function EmployeeWorkspace({ entries, selected, onSelect, role="employee" }: {
  entries: TimeEntry[]; selected: EntryStatus | "all"; onSelect: (status: EntryStatus | "all") => void; role?:"employee"|"contractor"|"manager"
}) {
  const contractor=role==="contractor"
  const manager=role==="manager"
  const options = [
    { status: "all", label: "All my entries", icon: ListChecks },
    { status: "draft", label: "Drafts", icon: ClipboardList },
    { status: "submitted", label: "Awaiting approval", icon: Send },
    { status: "rejected", label: "Needs correction", icon: XCircle },
    { status: "approved", label: "Approved", icon: CheckCircle2 },
  ] as const
  return <section aria-label={contractor?"Contractor workflow":manager?"Manager personal workflow":"Employee workflow"} className="flex flex-wrap items-center gap-2">
    <h2 className="mr-2 text-sm font-semibold">{contractor?"Contractor submissions":manager?"Manager personal timesheets":"Internal employee time"}</h2>
    {contractor&&<dl className="flex w-full flex-wrap gap-5 border-b pb-3 text-sm"><div><dt className="text-muted-foreground">Submitted hours</dt><dd className="font-semibold">{entries.filter(entry=>entry.status==="submitted").reduce((total,entry)=>total+entry.hours,0)}</dd></div><div><dt className="text-muted-foreground">Approved hours</dt><dd className="font-semibold text-green-700">{entries.filter(entry=>entry.status==="approved").reduce((total,entry)=>total+entry.hours,0)}</dd></div><div><dt className="text-muted-foreground">Contract projects</dt><dd className="font-semibold">{new Set(entries.map(entry=>entry.project)).size}</dd></div></dl>}
    {options.map(({status,label,icon:Icon}) => <Button key={status} className="feature-control" data-feature={status} variant="outline" aria-pressed={selected === status} aria-haspopup="dialog" onClick={() => onSelect(status)}>
      <Icon className="size-4" aria-hidden="true" />{label}
      <span className="tabular-nums">{status === "all" ? entries.length : entries.filter(entry => entry.status === status).length}</span>
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Button>)}
  </section>
}
