/**
 * Provides personal workflow shortcuts for employees and baseline users.
 * Status buttons filter only the entries already authorized by the server.
 * This component never fetches team records or exposes administrative actions.
 */
"use client"
import { ArrowRight, BarChart3, CalendarClock, CheckCircle2, ClipboardList, Clock3, FilePlus2, FolderKanban, KeyRound, ListChecks, Send, ShieldCheck, UserRoundCog, Users, XCircle } from "lucide-react"
import type { EntryStatus, TimeEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { getRoleActions, type RoleActionId } from "@/lib/role-actions"

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
export function RoleWorkspaceHome({ role, entries, teamEntries = [], pending, canCreate, canReview, canReports, canManageProjects = false, canCreateProjects = false, canManageAccess = false, canViewActivity = false, canManagePeriods = false, canViewAllTimesheets = false, canViewAccounts = false, onTimesheets, onReviews, onLogTime, onReport, onProjects, onTeamAccess, onActivity, onPeriodSettings, onFinalApprovals }: {
  role: "contractor" | "employee" | "manager" | "account_manager"
  entries: TimeEntry[]
  teamEntries?: TimeEntry[]
  pending: number
  canCreate: boolean
  canReview: boolean
  canReports: boolean
  canManageProjects?: boolean
  canCreateProjects?: boolean
  canManageAccess?: boolean
  canViewActivity?: boolean
  canManagePeriods?: boolean
  canViewAllTimesheets?: boolean
  canViewAccounts?: boolean
  onTimesheets: () => void
  onReviews: () => void
  onLogTime: () => void
  onReport?: () => void
  onProjects?: () => void
  onTeamAccess?: () => void
  onActivity?: () => void
  onPeriodSettings?: () => void
  onFinalApprovals?: () => void
}) {
  const personal = entries
  const isContractor = role === "contractor"
  const isManager = role === "manager"
  const isAccountManager = role === "account_manager"
  const actions = getRoleActions(role, { create_entries: canCreate, review_entries: canReview, view_reports: canReports, manage_projects: canManageProjects, create_projects: canCreateProjects, delegate_permissions: canManageAccess, view_personal_reports: canViewActivity, view_accounts: canViewAccounts, view_all_timesheets: canViewAllTimesheets, manage_timesheet_periods: canManagePeriods })
  const handlers: Partial<Record<RoleActionId, () => void>> = { log_time: onLogTime, timesheets: onTimesheets, approvals: onReviews, reports: onReport, projects: onProjects, team_access: onTeamAccess, account_activity: onActivity, final_approvals: onFinalApprovals, period_settings: onPeriodSettings }
  const icon: Record<RoleActionId, typeof Clock3> = { log_time: FilePlus2, timesheets: Clock3, approvals: CheckCircle2, reports: BarChart3, projects: FolderKanban, team_access: KeyRound, account_activity: UserRoundCog, final_approvals: ShieldCheck, period_settings: CalendarClock }
  const title = isAccountManager ? "Account manager" : isContractor ? "Contractor" : isManager ? "Manager" : "Employee"
  const approvedHours = personal.filter(entry => entry.status === "approved").reduce((total, entry) => total + entry.hours, 0)
  return <section aria-label={`${role} workspace home`} className={`min-w-0 overflow-hidden rounded-md border ${isContractor ? "border-orange-200 bg-orange-50/30" : isManager || isAccountManager ? "border-blue-200 bg-blue-50/30" : "border-emerald-200 bg-emerald-50/30"}`}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 px-3 py-2">
      <div className="flex min-w-0 items-baseline gap-x-2"><h2 className="text-sm font-semibold text-slate-950">{title} dashboard</h2><p className="truncate text-xs text-slate-600">{isAccountManager ? "Final review, periods, and workforce controls." : isManager ? "Review team work and manage assigned workflows." : isContractor ? "Log assigned project work and track submissions." : "Record work and follow its approval status."}</p></div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-700" aria-label="Timesheet summary">
        {isManager ? <><span><strong className="text-orange-800">{pending}</strong> awaiting review</span><span><strong>{teamEntries.length}</strong> team entries</span></> : isAccountManager ? <><span>Manager-approved evidence</span><span>Final review before finance handoff</span></> : <><span><strong>{personal.filter(entry => entry.status === "draft").length}</strong> drafts</span><span><strong>{personal.filter(entry => entry.status === "submitted").length}</strong> awaiting manager</span><span><strong className="text-emerald-800">{approvedHours.toLocaleString(undefined,{maximumFractionDigits:2})}h</strong> approved</span></>}
      </div>
    </header>
    <nav aria-label={`${role} dashboard actions`} className="flex flex-wrap gap-1.5 p-2">
      {actions.map(action => { const Icon = icon[action.id]; const handler = handlers[action.id]; return handler ? <Button key={action.id} size="sm" variant={action.id === "log_time" || action.id === "final_approvals" ? "default" : "outline"} className="h-8" onClick={handler}><Icon className="size-3.5"/>{action.label}<ArrowRight className="size-3"/></Button> : null })}
    </nav>
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
