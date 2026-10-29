/**
 * Provides personal workflow shortcuts for employees and baseline users.
 * Status buttons filter only the entries already authorized by the server.
 * This component never fetches team records or exposes administrative actions.
 */
"use client"
import { useState } from "react"
import { ArrowRight, BarChart3, CalendarClock, CheckCircle2, ClipboardList, Clock3, FilePlus2, FolderKanban, KeyRound, ListChecks, Send, ShieldCheck, Sparkles, Timer, UserRoundCog, Users, XCircle } from "lucide-react"
import type { EntryStatus, TimeEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { getRoleActions, type RoleActionId } from "@/lib/role-actions"
import { ManagerTeamDirectory } from "@/components/manager-team-directory"
import { DataExportMenu } from "@/components/data-export-menu"

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
 * @param props.canExport - Whether visible timesheet and team records may be exported.
 * @param props.onTimesheets - Opens the Timesheets command group.
 * @param props.onReviews - Opens the Reviews command group.
 * @param props.onLogTime - Opens the time-entry capture workflow.
 * @returns A compact workspace home tailored to the active role.
 */
export function RoleWorkspaceHome({ role, entries, teamEntries = [], pending, canCreate, canReview, canReports, canExport = false, canManageProjects = false, canCreateProjects = false, canManageAccess = false, canViewActivity = false, canManagePeriods = false, canViewAllTimesheets = false, canViewAccounts = false, canRequestExtension = false, onTimesheets, onReviews, onLogTime, onReport, onProjects, onTeamAccess, onActivity, onPeriodSettings, onFinalApprovals, onRequestExtension }: {
  role: "contractor" | "employee" | "manager" | "account_manager"
  entries: TimeEntry[]
  teamEntries?: TimeEntry[]
  pending: number
  canCreate: boolean
  canReview: boolean
  canReports: boolean
  canExport?: boolean
  canManageProjects?: boolean
  canCreateProjects?: boolean
  canManageAccess?: boolean
  canViewActivity?: boolean
  canManagePeriods?: boolean
  canViewAllTimesheets?: boolean
  canViewAccounts?: boolean
  canRequestExtension?: boolean
  onTimesheets: () => void
  onReviews: () => void
  onLogTime: () => void
  onReport?: () => void
  onProjects?: () => void
  onTeamAccess?: () => void
  onActivity?: () => void
  onPeriodSettings?: () => void
  onFinalApprovals?: () => void
  onRequestExtension?: () => void
}) {
  const [recentSearch,setRecentSearch]=useState("")
  const [recentStatus,setRecentStatus]=useState("all")
  const [teamSearch,setTeamSearch]=useState("")
  const [teamStatus,setTeamStatus]=useState("all")
  const [projectSearch,setProjectSearch]=useState("")
  const personal = entries
  const isContractor = role === "contractor"
  const isManager = role === "manager"
  const isAccountManager = role === "account_manager"
  const actions = getRoleActions(role, { create_entries: canCreate, review_entries: canReview, view_reports: canReports, manage_projects: canManageProjects, create_projects: canCreateProjects, delegate_permissions: canManageAccess, view_personal_reports: canViewActivity, view_accounts: canViewAccounts, view_all_timesheets: canViewAllTimesheets, manage_timesheet_periods: canManagePeriods })
  const handlers: Partial<Record<RoleActionId, () => void>> = { log_time: onLogTime, timesheets: onTimesheets, approvals: onReviews, reports: onReport, projects: onProjects, team_access: onTeamAccess, account_activity: onActivity, final_approvals: onFinalApprovals, period_settings: onPeriodSettings }
  const icon: Record<RoleActionId, typeof Clock3> = { log_time: FilePlus2, timesheets: Clock3, approvals: CheckCircle2, reports: BarChart3, projects: FolderKanban, team_access: KeyRound, account_activity: UserRoundCog, final_approvals: ShieldCheck, period_settings: CalendarClock }
  const title = isAccountManager ? "Account manager" : isContractor ? "Contractor" : isManager ? "Manager" : "Employee"
  const approvedHours = personal.filter(entry => entry.status === "approved").reduce((total, entry) => total + entry.hours, 0)
  const allRecentEntries = [...personal].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const recentEntries=allRecentEntries.filter(entry=>(recentStatus==="all"||entry.status===recentStatus)&&[entry.date,entry.project,entry.description,entry.status].join(" ").toLowerCase().includes(recentSearch.trim().toLowerCase()))
  const projectTotals = [...personal.reduce((totals, entry) => {
    const current = totals.get(entry.project) ?? { hours: 0, entries: 0 }
    current.hours += Number(entry.hours) || 0
    current.entries += 1
    totals.set(entry.project, current)
    return totals
  }, new Map<string, { hours: number; entries: number }>())].sort((a, b) => b[1].hours - a[1].hours || a[0].localeCompare(b[0]))
  const visibleProjectTotals=projectTotals.filter(([project])=>project.toLowerCase().includes(projectSearch.trim().toLowerCase()))
  const visibleTeamEntries=[...teamEntries].filter(entry=>(teamStatus==="all"||entry.status===teamStatus)&&[entry.contractor,entry.project,entry.description,entry.date,entry.status].join(" ").toLowerCase().includes(teamSearch.trim().toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))
  const returnedEntries = personal.filter(entry => entry.status === "rejected").length
  return <section aria-label={`${role} workspace home`} className={`min-w-0 overflow-hidden rounded-md border ${isContractor ? "border-orange-200 bg-orange-50/30" : isManager || isAccountManager ? "border-blue-200 bg-blue-50/30" : "border-emerald-200 bg-emerald-50/30"}`}>
    <header className="flex flex-wrap items-center justify-between gap-1.5 border-b border-current/10 px-2.5 py-1.5">
      <div className="flex min-w-0 items-baseline gap-x-2"><h2 className="text-sm font-semibold text-slate-950">{title} dashboard</h2><p className="truncate text-xs text-slate-600">{isAccountManager ? "Final review, periods, and workforce controls." : isManager ? "Review team work and manage assigned workflows." : isContractor ? "Log assigned project work and track submissions." : "Record work and follow its approval status."}</p></div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-700" aria-label="Timesheet summary">
        {isManager ? <><span><strong className="text-orange-800">{pending}</strong> awaiting review</span><span><strong>{teamEntries.length}</strong> team entries</span></> : isAccountManager ? <><span>Manager-approved evidence</span><span>Final review before finance handoff</span></> : <><span><strong>{personal.filter(entry => entry.status === "draft").length}</strong> drafts</span><span><strong>{personal.filter(entry => entry.status === "submitted").length}</strong> awaiting manager</span>{isContractor&&<span><strong className={returnedEntries?"text-red-800":"text-emerald-800"}>{returnedEntries}</strong> returned</span>}<span><strong className="text-emerald-800">{approvedHours.toLocaleString(undefined,{maximumFractionDigits:2})}h</strong> approved</span></>}
      </div>
    </header>
    {canCreate&&<div className="border-b border-orange-200 bg-orange-50/70 px-3 py-2">
      <Button onClick={onLogTime} className="h-11 gap-2.5 border border-orange-800 bg-orange-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-800 focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2">
        <span className="grid size-7 place-items-center rounded-sm bg-white/15"><Sparkles aria-hidden="true" className="size-4"/></span>
        Extract timesheet with AI
        <ArrowRight aria-hidden="true" className="size-4"/>
      </Button>
    </div>}
    <nav aria-label={`${role} dashboard actions`} className="flex flex-wrap gap-1 border-b border-current/10 px-2 py-1.5">
      {actions.filter(action=>action.id!=="log_time").map(action => { const Icon = icon[action.id]; const handler = handlers[action.id]; return handler ? <Button key={action.id} size="sm" variant={action.id === "final_approvals" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={handler}><Icon className="size-3.5"/>{action.label}<ArrowRight className="size-3"/></Button> : null })}
      {isManager&&canRequestExtension&&onRequestExtension&&<Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onRequestExtension}><Timer className="size-3.5"/>Request extension</Button>}
    </nav>
    {isManager&&<ManagerTeamDirectory canExport={canExport}/>}
    {isManager&&<section aria-label="Manager team timesheets" className="min-w-0 border-b border-blue-200 bg-white/80">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-sky-50/60 px-2.5 py-1.5"><div><h3 className="text-xs font-semibold text-sky-950">Team timesheet activity</h3><p className="text-[10px] text-slate-600">Only submissions available in your manager scope are included.</p></div>{canExport&&<DataExportMenu title="Manager team timesheets" filename="manager-team-timesheets" rows={visibleTeamEntries.map(entry=>({person:entry.contractor,workDate:entry.date,project:entry.project,description:entry.description,status:entry.status,hours:Number(entry.hours)}))} summary={{entries:visibleTeamEntries.length,shownOf:teamEntries.length,status:teamStatus,search:teamSearch||"None",hours:Number(visibleTeamEntries.reduce((sum,entry)=>sum+Number(entry.hours),0).toFixed(2))}}/>}</header>
      <div className="grid gap-1.5 border-b border-slate-100 p-2 sm:grid-cols-[minmax(0,1fr)_10rem]"><label className="sr-only" htmlFor="manager-team-entry-search">Search team timesheets</label><input id="manager-team-entry-search" type="search" value={teamSearch} onChange={event=>setTeamSearch(event.target.value)} placeholder="Search people, projects, dates, or work" className="h-7 min-w-0 border border-slate-300 bg-white px-2 text-xs"/><label className="sr-only" htmlFor="manager-team-entry-status">Filter team timesheets by status</label><select id="manager-team-entry-status" value={teamStatus} onChange={event=>setTeamStatus(event.target.value)} className="h-7 border border-slate-300 bg-white px-2 text-xs"><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Returned</option></select></div>
      {visibleTeamEntries.length?<div className="max-h-64 overflow-auto overscroll-contain"><table className="w-full min-w-[38rem] text-left text-xs"><thead className="sticky top-0 z-[1] bg-sky-50 text-[10px] uppercase text-sky-950"><tr><th className="px-2 py-1 font-semibold">Person</th><th className="px-2 py-1 font-semibold">Work date</th><th className="px-2 py-1 font-semibold">Project and work</th><th className="px-2 py-1 font-semibold">Status</th><th className="px-2 py-1 text-right font-semibold">Hours</th></tr></thead><tbody>{visibleTeamEntries.map(entry=><tr key={entry.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/70"><td className="max-w-40 truncate px-2 py-1.5 font-medium" title={entry.contractor}>{entry.contractor}</td><td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px]">{entry.date}</td><td className="max-w-80 px-2 py-1.5"><span className="block truncate font-medium" title={entry.project}>{entry.project}</span><span className="block truncate text-[10px] text-slate-600" title={entry.description}>{entry.description||"No description"}</span></td><td className="px-2 py-1.5 capitalize">{entry.status==="rejected"?"Returned":entry.status}</td><td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{Number(entry.hours).toLocaleString(undefined,{maximumFractionDigits:2})}h</td></tr>)}</tbody></table></div>:<p className="px-3 py-4 text-xs text-slate-600">{teamEntries.length?"No submissions match these filters.":"No team submissions are available in your review scope yet."}</p>}
      <p className="border-t border-slate-100 px-3 py-1 text-[10px] text-slate-500">Showing {visibleTeamEntries.length} of {teamEntries.length} submissions</p>
    </section>}
    {isAccountManager&&<section aria-label="My timesheet summary" className="grid grid-cols-2 gap-px border-b border-blue-200 bg-blue-200 sm:grid-cols-4">
      <div className="bg-white/80 px-2.5 py-1.5"><p className="text-[10px] text-slate-600">My entries</p><p className="text-sm font-semibold tabular-nums">{personal.length}</p></div>
      <div className="bg-white/80 px-2.5 py-1.5"><p className="text-[10px] text-slate-600">Awaiting review</p><p className="text-sm font-semibold tabular-nums">{personal.filter(entry=>entry.status==="submitted").length}</p></div>
      <div className="bg-white/80 px-2.5 py-1.5"><p className="text-[10px] text-slate-600">Approved hours</p><p className="text-sm font-semibold tabular-nums">{approvedHours.toLocaleString(undefined,{maximumFractionDigits:2})}h</p></div>
      <div className="bg-white/80 px-2.5 py-1.5"><p className="text-[10px] text-slate-600">Projects worked</p><p className="text-sm font-semibold tabular-nums">{new Set(personal.map(entry=>entry.project)).size}</p></div>
    </section>}
    {(isContractor||isAccountManager)&&<div className={`grid min-w-0 border-t ${isContractor?"border-orange-200":"border-blue-200"} bg-white/70 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.9fr)]`}>
      <section aria-label={isContractor?"Recent contractor work":"Recent personal entries"} className="min-w-0 border-b border-orange-100 lg:border-b-0 lg:border-r">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2.5 py-1.5"><div><h3 className="text-xs font-semibold text-slate-950">{isContractor?"Recent work":"Recent personal entries"}</h3><p className="text-[10px] text-slate-600">Latest saved time entries</p></div><div className="flex items-center gap-2"><DataExportMenu title="Recent personal timesheets" filename="recent-personal-timesheets" rows={recentEntries.map(entry=>({workDate:entry.date,project:entry.project,description:entry.description,status:entry.status,hours:Number(entry.hours)}))} summary={{entries:recentEntries.length,shownOf:personal.length,hours:Number(recentEntries.reduce((sum,entry)=>sum+Number(entry.hours),0).toFixed(2)),search:recentSearch||"None",status:recentStatus}}/><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onTimesheets}>All timesheets<ArrowRight className="size-3"/></Button></div></header>
        <div className="grid gap-1.5 border-b border-slate-100 p-2 sm:grid-cols-[minmax(0,1fr)_9rem]"><label className="sr-only" htmlFor="dashboard-entry-search">Search recent work</label><input id="dashboard-entry-search" type="search" value={recentSearch} onChange={event=>setRecentSearch(event.target.value)} placeholder="Search recent work" className="h-7 min-w-0 border border-slate-300 bg-white px-2 text-xs"/><label className="sr-only" htmlFor="dashboard-entry-status">Filter recent work by status</label><select id="dashboard-entry-status" value={recentStatus} onChange={event=>setRecentStatus(event.target.value)} className="h-7 border border-slate-300 bg-white px-2 text-xs"><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Needs correction</option></select></div>
        {recentEntries.length?<div className="max-h-96 overflow-auto overscroll-contain"><table className="w-full min-w-[34rem] text-left text-xs"><thead className="sticky top-0 z-[1] bg-sky-50 text-[10px] uppercase text-sky-950"><tr><th className="px-2 py-1 font-semibold">Work date</th><th className="px-2 py-1 font-semibold">Project and work</th><th className="px-2 py-1 font-semibold">Status</th><th className="px-2 py-1 text-right font-semibold">Hours</th></tr></thead><tbody>{recentEntries.map(entry=><tr key={entry.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/70"><td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-700">{entry.date}</td><td className="max-w-0 px-2 py-1.5"><span className="block truncate font-medium" title={entry.project}>{entry.project}</span><span className="block truncate text-[10px] text-slate-600" title={entry.description}>{entry.description||"No description"}</span></td><td className="px-2 py-1.5"><span className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] capitalize ${entry.status==="approved"?"border-emerald-200 bg-emerald-50 text-emerald-800":entry.status==="submitted"?"border-blue-200 bg-blue-50 text-blue-800":entry.status==="rejected"?"border-red-200 bg-red-50 text-red-800":"border-orange-200 bg-orange-50 text-orange-900"}`}>{entry.status==="rejected"?"Needs correction":entry.status}</span></td><td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{Number(entry.hours).toLocaleString(undefined,{maximumFractionDigits:2})}h</td></tr>)}</tbody></table></div>:<p className="px-3 py-4 text-xs text-slate-600">{personal.length?"No entries match these filters.":"No saved work yet. Log project time to start your timesheet."}</p>}
        <p className="border-t border-slate-100 px-2 py-1 text-right text-[10px] text-slate-600">Showing {recentEntries.length} of {personal.length} entries</p>
      </section>
      <section aria-label="Hours by project" className="min-w-0">
        <header className="border-b border-slate-200 px-2.5 py-1.5"><h3 className="text-xs font-semibold text-slate-950">Hours by project</h3><p className="text-[10px] text-slate-600">Across your saved timesheets</p></header>
        <label className="block border-b border-slate-100 p-2"><span className="sr-only">Search project totals</span><input type="search" value={projectSearch} onChange={event=>setProjectSearch(event.target.value)} placeholder="Search projects" className="h-7 w-full border border-slate-300 bg-white px-2 text-xs"/></label>
        {visibleProjectTotals.length?<ul className="max-h-96 divide-y divide-slate-200 overflow-auto overscroll-contain">{visibleProjectTotals.map(([project,summary])=><li key={project} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2"><span className="min-w-0"><span className="block truncate text-xs font-medium" title={project}>{project}</span><span className="text-[10px] text-slate-600">{summary.entries} {summary.entries===1?"entry":"entries"}</span></span><span className="shrink-0 text-xs font-semibold tabular-nums text-sky-950">{summary.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h</span></li>)}</ul>:<p className="px-3 py-4 text-xs text-slate-600">{projectTotals.length?"No projects match this search.":"Project totals will appear when you log time."}</p>}
        <p className="border-t border-slate-100 px-3 py-1 text-[10px] text-slate-500">Showing {visibleProjectTotals.length} of {projectTotals.length} projects</p>
      </section>
    </div>}
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
