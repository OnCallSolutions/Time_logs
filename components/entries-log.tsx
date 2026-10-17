"use client"

/**
 * Provides the editable entries table used for personal, team, and approval logs.
 *
 * This component is shared by regular users, managers, and administrators. Its
 * props control whether the table describes personal or team data, whether status
 * workflow controls are available, and whether elevated bulk clearing controls
 * should be available.
 */
import { AlertTriangle, Download, FilterX, Search, ClipboardList, Trash2 } from "lucide-react"
import { Fragment,useEffect,useState } from "react"
import { EntryLogRow, type EntryMutation, type EntryTransition } from "@/components/entry-log-row"
import { EntryReviewDialog } from "@/components/manager-workspace"
import { SubmissionActions } from "@/components/submission-actions"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { EntryStatus, TimeEntry } from "@/lib/types"

/**
 * Creates a stable identity for the selected visual grouping without merging records.
 * @param entry - Timesheet row being grouped.
 * @param groupBy - Active grouping dimension.
 * @returns Group key, or an empty key when grouping is disabled.
 */
function entryGroupKey(entry:TimeEntry,groupBy:string):string {
  if(groupBy==="project")return entry.project
  if(groupBy==="day")return entry.date
  if(groupBy==="person")return `${entry.contractor.toLocaleLowerCase()}\u0000${entry.ownerEmail?.toLocaleLowerCase()??entry.contractor.toLocaleLowerCase()}`
  return ""
}

/**
 * Provides the human-readable heading for a timesheet group.
 * @param entry - First entry in the group.
 * @param groupBy - Active grouping dimension.
 * @returns Group heading shown before matching records.
 */
function entryGroupLabel(entry:TimeEntry,groupBy:string):string {
  if(groupBy==="project")return `Project: ${entry.project}`
  if(groupBy==="day")return `Day: ${entry.date}`
  if(groupBy==="person")return `Patron: ${entry.contractor}`
  return ""
}

/**
 * Applies the selected sort while keeping each configured group contiguous.
 * @param a - First entry to compare.
 * @param b - Second entry to compare.
 * @param sortBy - User-selected sort mode.
 * @param groupBy - User-selected grouping dimension.
 * @returns Negative, zero, or positive comparison result.
 */
function compareEntries(a:TimeEntry,b:TimeEntry,sortBy:string,groupBy:string):number {
  const groupOrder=groupBy==="none"?0:entryGroupKey(a,groupBy).localeCompare(entryGroupKey(b,groupBy))
  if(groupOrder!==0)return groupOrder
  const dateNewest=()=>b.date.localeCompare(a.date)
  const compare={
    date_newest:dateNewest,
    date_oldest:()=>a.date.localeCompare(b.date),
    project_az:()=>a.project.localeCompare(b.project)||dateNewest(),
    person_az:()=>a.contractor.localeCompare(b.contractor)||dateNewest(),
    hours_high:()=>Number(b.hours)-Number(a.hours),
    hours_low:()=>Number(a.hours)-Number(b.hours),
    status:()=>["draft","submitted","approved","rejected"].indexOf(a.status)-["draft","submitted","approved","rejected"].indexOf(b.status),
  }[sortBy]??dateNewest
  return compare()||a.project.localeCompare(b.project)||a.contractor.localeCompare(b.contractor)||a.id.localeCompare(b.id)
}

/**
 * Downloads only currently visible rows as spreadsheet-safe CSV.
 * @param entries - Already permission-scoped and filtered timesheet rows.
 * @returns void after initiating a local download.
 */
function downloadTimesheetCsv(entries:TimeEntry[]):void {
  const fields=["Contractor","Date","Project","Description","Hours","Status"] as const
  const rows=entries.map(entry=>[entry.contractor,entry.date,entry.project,entry.description,entry.hours,entry.status])
  const cell=(value:unknown)=>{
    const text=String(value??"")
    const safe=/^[\u0000-\u0020]*[=+\-@]/.test(text)?`'${text}`:text
    return `"${safe.replaceAll('"','""')}"`
  }
  const csv=[fields.map(cell).join(","),...rows.map(row=>row.map(cell).join(","))].join("\r\n")
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}))
  const link=document.createElement("a")
  link.href=url
  link.download=`timesheets-${new Date().toISOString().slice(0,10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Renders editable time entries with role-aware clearing controls.
 *
 * Rows start read-only and open isolated drafts through a pencil control. Save
 * awaits persistence; Cancel discards input. Repeated person/date/project labels
 * are clustered without combining records. Owner identity prevents own-work review.
 *
 * @param props - Entries table props and row action callbacks.
 * @param props.userEmail - Authenticated identity used to protect own submitted work.
 * @param props.submissionDestination - Existing manager or account-manager review queue.
 * @param props.canEdit - Current field-edit permission.
 * @param props.canDelete - Current removal permission.
 * @param props.canClear - Whether to show the bulk clear button.
 * @param props.canExport - Whether the caller may export currently visible entries.
 * @param props.canReview - Whether to show manager approval controls.
 * @param props.canSubmit - Whether to show employee submission controls.
 * @param props.description - Supporting text shown under the table title.
 * @param props.entries - Entries to display and edit.
 * @param props.onUpdate - Callback invoked when a complete entry draft is explicitly saved.
 * @param props.onStatusChange - Callback invoked when approval status changes.
 * @param props.onDelete - Callback invoked when an entry is deleted.
 * @param props.onClear - Callback invoked when visible entries are cleared.
 * @param props.title - Heading displayed above the table.
 * @returns An editable entries table or empty-state panel.
 */
export function EntriesLog({
  userEmail,
  submissionDestination = "manager",
  canRequestReview = false,
  onRequestReview,
  canEdit = true,
  canDelete = true,
  canClear = false,
  canExport = false,
  canReview = false,
  canSubmit = false,
  canSubmitOthers = false,
  periodView = false,
  description = "Review your saved entries.",
  entries,
  onUpdate,
  onStatusChange,
  onDelete,
  onClear,
  title = "Time entries",
}: {
  userEmail?: string
  submissionDestination?: "manager" | "account_manager"
  canRequestReview?: boolean
  onRequestReview?: (entries: TimeEntry[]) => void
  canEdit?: boolean
  canDelete?: boolean
  canClear?: boolean
  canExport?: boolean
  canReview?: boolean
  canSubmit?: boolean
  canSubmitOthers?: boolean
  periodView?: boolean
  description?: string
  entries: TimeEntry[]
  onUpdate: EntryMutation
  onStatusChange: EntryTransition
  onDelete: (id: string) => void
  onClear: () => void
  title?: string
}) {
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submissionRequest,setSubmissionRequest]=useState(0)
  const [status, setStatus] = useState<EntryStatus | "all">("all")
  const [project, setProject] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateThrough, setDateThrough] = useState("")
  const [sortBy, setSortBy] = useState("date_newest")
  const [groupBy, setGroupBy] = useState("project")
  const [review, setReview] = useState<{ entry: TimeEntry; decision: "approved" | "rejected" } | null>(null)
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false)
  const [submissionDeadline,setSubmissionDeadline]=useState<string|null>(null)
  const [periods,setPeriods]=useState<Array<{id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;managerGraceDays:number}>>([])
  const [periodSelection,setPeriodSelection]=useState("current")
  const [periodsLoaded,setPeriodsLoaded]=useState(false)
  const [deadlineLoaded,setDeadlineLoaded]=useState(false)
  useEffect(()=>{if(!canReview)setReview(null)},[canReview])
  useEffect(()=>{
    if(!canSubmit&&!periodView){setDeadlineLoaded(false);return}
    const controller=new AbortController()
    fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(response.ok)setPeriods(data.periods??[])
      if(response.ok&&!(data.periods??[]).length){const legacy=await fetch(apiPath("/api/submission-deadline"),{cache:"no-store",signal:controller.signal});const boundary=await legacy.json();if(legacy.ok)setSubmissionDeadline(boundary.deadline??null)}
    }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted){setDeadlineLoaded(true);setPeriodsLoaded(true)}})
    return()=>controller.abort()
  },[canSubmit,periodView])
  const now=Date.now()
  const todayDate=new Date()
  const today=[todayDate.getFullYear(),String(todayDate.getMonth()+1).padStart(2,"0"),String(todayDate.getDate()).padStart(2,"0")].join("-")
  const activePeriod=periods.find(period=>period.startDate<=today&&period.endDate>=today)
  const periodEntries=!periodView?entries:!periodsLoaded?[]:periods.length===0?entries:periodSelection==="current"?(activePeriod?entries.filter(entry=>entry.date>=activePeriod.startDate&&entry.date<=activePeriod.endDate):[]):periodSelection==="archived"?entries.filter(entry=>periods.some(period=>period.endDate<today&&entry.date>=period.startDate&&entry.date<=period.endDate)):periodSelection==="all"?entries:periodSelection==="unassigned"?entries.filter(entry=>!periods.some(period=>entry.date>=period.startDate&&entry.date<=period.endDate)):entries.filter(entry=>{const period=periods.find(candidate=>candidate.id===periodSelection);return !!period&&entry.date>=period.startDate&&entry.date<=period.endDate})
  const isEntrySubmissionOpen=(entry:TimeEntry,own:boolean)=>{
    if(periods.length){
      const period=periods.find(candidate=>entry.date>=candidate.startDate&&entry.date<=candidate.endDate)
      if(!period)return false
      const deadline=Date.parse(period.submissionDeadline)
      if(now<=deadline)return true
      return canSubmitOthers&&now<=deadline+period.managerGraceDays*86_400_000
    }
    return !submissionDeadline||now<Date.parse(submissionDeadline)
  }
  const displayedDeadline=periods.find(period=>period.endDate>=new Date().toISOString().slice(0,10))?.submissionDeadline??submissionDeadline
  const submissionClosed=!!displayedDeadline&&Date.parse(displayedDeadline)<=now
  const visibleEntries = periodEntries.filter(entry =>
    (status === "all" || entry.status === status) &&
    (project === "all" || entry.project === project) &&
    (!dateFrom || entry.date >= dateFrom) &&
    (!dateThrough || entry.date <= dateThrough) &&
    [entry.contractor, entry.project, entry.description, entry.date, entry.status].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a,b)=>compareEntries(a,b,sortBy,groupBy))
  const selectable = (canSubmit || canSubmitOthers || canRequestReview) && !!userEmail
  const selectedIdSet = new Set(selectedIds)
  const visibleIdSet = new Set(visibleEntries.map(entry => entry.id))
  const submissions = canSubmit&&userEmail ? periodEntries.filter(entry => !entry.payoutEligible && (entry.status === "draft" || entry.status === "rejected") && (entry.ownerEmail?.toLowerCase() === userEmail.toLowerCase() || canSubmitOthers) && isEntrySubmissionOpen(entry,entry.ownerEmail?.toLowerCase()===userEmail.toLowerCase())) : []
  const requestable = canRequestReview ? periodEntries.filter(entry=>entry.status==="submitted"&&(entry.reviewEligible||entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())) : []
  const eligible = [...submissions,...requestable]
  const eligibleIdSet = new Set(eligible.map(entry => entry.id))
  const selected = eligible.filter(entry => selectedIdSet.has(entry.id))
  const matchingEligible = eligible.filter(entry => visibleIdSet.has(entry.id))
  const allMatchingSelected = matchingEligible.length > 0 && matchingEligible.every(entry => selectedIdSet.has(entry.id))
  if (entries.length === 0) {
    return (
      <div className="border-y border-border bg-card/50">
      {canSubmit&&<p role="status" className={`border-b px-4 py-2 text-xs ${submissionClosed?"border-red-200 bg-red-50 text-red-900":"border-orange-200 bg-orange-50/70 text-orange-950"}`}>{displayedDeadline?(submissionClosed?`Submission deadline passed: ${new Date(displayedDeadline).toLocaleString()}.`:`Timesheet submissions close ${new Date(displayedDeadline).toLocaleString()}.`):`${deadlineLoaded?"No organization submission deadline is configured; submissions remain open.":"Checking submission deadline..."}`}</p>}
      <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-6 w-full max-w-3xl text-left">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">0 entries · {description}</p>
        </div>
        <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ClipboardList className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">No entries yet</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground text-pretty">
          Saved timesheet source entries will appear here when they are available.
        </p>
      </div>
      </div>
    )
  }

  const total = visibleEntries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0)
  const clearFilters = () => { setQuery("");setStatus("all");setProject("all");setDateFrom("");setDateThrough("");setSortBy("date_newest");setGroupBy("project") }
  const filtersActive = !!query || status !== "all" || project !== "all" || !!dateFrom || !!dateThrough || sortBy !== "date_newest" || groupBy !== "project"
  const groupTotals = new Map<string,{count:number;hours:number;label:string}>()
  for (const entry of visibleEntries) {
    const key = entryGroupKey(entry,groupBy)
    if (!key) continue
    const current = groupTotals.get(key) ?? {count:0,hours:0,label:entryGroupLabel(entry,groupBy)}
    current.count += 1
    current.hours += Number(entry.hours) || 0
    groupTotals.set(key,current)
  }

  return (
    <div className="overflow-hidden border-y border-border bg-card">
      {clearConfirmationOpen && <WindowSurface title="Confirm clearing timesheets" onBack={() => setClearConfirmationOpen(false)} compact resizable>
        <section className="flex w-full max-w-xl flex-col bg-white text-slate-950">
          <header className="flex items-start gap-3 border-b border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
            <div><h2 className="font-semibold text-red-950">Clear all visible timesheet entries?</h2><p className="mt-1 text-sm text-red-900">This starts Microsoft Entra verification. Nothing is deleted until you sign in again and confirm a second time.</p></div>
          </header>
          <p className="p-4 text-sm">The action applies to the entries visible to your authorized account ({entries.length} currently loaded). It cannot be undone.</p>
          <footer className="flex justify-end gap-2 border-t p-4">
            <Button variant="outline" onClick={() => setClearConfirmationOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setClearConfirmationOpen(false); onClear() }}><Trash2 className="size-4" />Continue to Entra verification</Button>
          </footer>
        </section>
      </WindowSurface>}
      {review && <EntryReviewDialog entry={review.entry} decision={review.decision} onCancel={() => setReview(null)} onConfirm={async note => {
        await onStatusChange(review.entry.id, review.decision, note || undefined, review.entry.revision)
        setReview(null)
      }} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {periodEntries.length} {periodEntries.length === 1 ? "entry" : "entries"} ·{" "}
            {description}
          </p>
        </div>
        {canClear && (
          <Button variant="destructive" size="sm" onClick={() => setClearConfirmationOpen(true)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Clear all
          </Button>
        )}
        {canExport&&<Button variant="outline" size="sm" disabled={!visibleEntries.length} onClick={()=>downloadTimesheetCsv(visibleEntries)} className="border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"><Download className="size-3.5" aria-hidden="true"/>Export visible ({visibleEntries.length})</Button>}
      </div>
      {periodView&&<div className="flex flex-wrap items-center gap-3 border-b border-indigo-200 bg-indigo-50/70 px-3 py-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-indigo-950">Timesheet period
          <select aria-label="Timesheet period" value={periodSelection} onChange={event=>setPeriodSelection(event.target.value)} disabled={!periodsLoaded||periods.length===0} className="h-9 max-w-full rounded-md border border-indigo-200 bg-white px-2 text-sm font-normal text-slate-900">
            <option value="current">Current period{activePeriod?` · ${activePeriod.name}`:""}</option>
            <option value="archived">Archived periods · all</option>
            <option value="all">All saved periods</option>
            <option value="unassigned">Outside configured periods</option>
            {[...periods].sort((a,b)=>b.startDate.localeCompare(a.startDate)).map(period=><option key={period.id} value={period.id}>{period.startDate<=today&&period.endDate>=today?"Current":period.startDate>today?"Upcoming":"Archived"} · {period.name} ({period.startDate} – {period.endDate})</option>)}
          </select>
        </label>
        <span role="status" className="text-xs text-indigo-900">{!periodsLoaded?"Loading period history…":periods.length===0?"No periods are configured; showing all saved timesheets.":periodSelection==="current"&&!activePeriod?"No period is active today. Select an archived or upcoming period.":periodSelection==="archived"?"Archived entries remain stored and can be retrieved by period.":`Showing ${periodEntries.length} entries for ${periodSelection==="current"?activePeriod?.name??"the current period":periodSelection==="all"?"all periods":periodSelection==="unassigned"?"dates outside configured periods":periods.find(period=>period.id===periodSelection)?.name??"the selected period"}.`}</span>
      </div>}
      {canSubmit&&<p role="status" className={`border-b px-4 py-2 text-xs ${submissionClosed?"border-red-200 bg-red-50 text-red-900":"border-orange-200 bg-orange-50/70 text-orange-950"}`}>{displayedDeadline?(submissionClosed?`Submission deadline passed: ${new Date(displayedDeadline).toLocaleString()}. Contact an administrator if you need an exception.`:`Timesheet submissions close ${new Date(displayedDeadline).toLocaleString()}.`):`${deadlineLoaded?"No organization submission deadline is configured; submissions remain open.":"Checking submission deadline..."}`}</p>}

      <div>
        <div className="grid gap-2 border-b border-sky-200 bg-sky-50/50 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input aria-label="Search entries" placeholder="Search person, project, work, date" value={query} onChange={event => setQuery(event.target.value)} className="h-9 w-full min-w-0 rounded-md border border-sky-200 bg-white px-3 text-sm" />
          </label>
          <select aria-label="Filter entry status" value={status} onChange={event => setStatus(event.target.value as EntryStatus | "all")} className="h-9 rounded-md border border-blue-200 bg-white px-2 text-sm">
            <option value="all">All statuses</option>
            {(["draft", "submitted", "approved", "rejected"] as const).map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </select>
          <select aria-label="Filter entry project" value={project} onChange={event=>setProject(event.target.value)} className="h-9 min-w-0 rounded-md border border-orange-200 bg-white px-2 text-sm">
            <option value="all">All projects</option>{[...new Set(periodEntries.map(entry=>entry.project))].sort((a,b)=>a.localeCompare(b)).map(value=><option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="Sort entries" value={sortBy} onChange={event=>setSortBy(event.target.value)} className="h-9 rounded-md border border-violet-200 bg-white px-2 text-sm">
            <option value="date_newest">Newest date</option><option value="date_oldest">Oldest date</option><option value="project_az">Project A-Z</option><option value="person_az">Person A-Z</option><option value="hours_high">Hours: high to low</option><option value="hours_low">Hours: low to high</option><option value="status">Status</option>
          </select>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">From<input aria-label="Entries from date" type="date" value={dateFrom} max={dateThrough||undefined} onChange={event=>setDateFrom(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-2 text-sm"/></label>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">Through<input aria-label="Entries through date" type="date" value={dateThrough} min={dateFrom||undefined} onChange={event=>setDateThrough(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-2 text-sm"/></label>
          <select aria-label="Group entries" value={groupBy} onChange={event=>setGroupBy(event.target.value)} className="h-9 rounded-md border border-teal-200 bg-white px-2 text-sm">
            <option value="project">Group by project</option><option value="day">Group by day</option><option value="person">Group by person</option><option value="none">No grouping</option>
          </select>
          <div className="flex items-center justify-between gap-2 sm:col-span-2 xl:col-span-1"><span className="text-xs font-medium text-slate-600">Showing {visibleEntries.length} / {periodEntries.length}</span><Button variant="outline" size="sm" title="Reset search, filters, sorting, and grouping" aria-label="Reset timesheet view" disabled={!filtersActive} onClick={clearFilters}><FilterX className="size-4"/>Reset view</Button></div>
        </div>
        {selectable && <div aria-label="Entry submission controls" className="flex flex-wrap items-center gap-2 border-b bg-orange-50/50 p-3">
          <Button variant="outline" size="sm" disabled={!eligible.length} onClick={() => setSelectedIds(eligible.map(entry => entry.id))}>Select all eligible ({eligible.length})</Button>
          <Button variant="ghost" size="sm" disabled={!selected.length} onClick={() => setSelectedIds([])}>Clear selection</Button>
          <span className="text-sm">{selected.length} selected / {matchingEligible.length} matching eligible</span>
          {canSubmit&&<SubmissionActions entries={submissions.filter(entry=>selectedIdSet.has(entry.id))} openRequest={submissionRequest} destination={submissionDestination} onStatusChange={onStatusChange} onSubmitted={id => setSelectedIds(previous => previous.filter(current => current !== id))} />}
          {canRequestReview&&onRequestReview&&<Button size="sm" variant="outline" disabled={!requestable.some(entry=>selectedIdSet.has(entry.id))||requestable.filter(entry=>selectedIdSet.has(entry.id)).length>50} onClick={()=>onRequestReview(requestable.filter(entry=>selectedIdSet.has(entry.id)))}>Request reviewer help ({requestable.filter(entry=>selectedIdSet.has(entry.id)).length})</Button>}
        </div>}
        {visibleEntries.length === 0 && <p role="status" className="p-4 text-sm text-muted-foreground">{periodView&&periodsLoaded&&periods.length>0&&periodSelection==="current"&&!activePeriod?"No timesheet period is active today. Select an archived or upcoming period to retrieve entries.":periodView&&periodsLoaded&&periods.length===0?"No saved timesheets match the current filters.":"No matching entries."}</p>}
        <div tabIndex={0} aria-label="Scrollable time entries" className="max-h-[65dvh] overflow-auto overscroll-contain">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              {selectable && <th className="px-3 py-2"><input type="checkbox" aria-label="Select all matching eligible entries" checked={allMatchingSelected} disabled={!matchingEligible.length} ref={input => { if (input) input.indeterminate = !allMatchingSelected && matchingEligible.some(entry => selectedIds.includes(entry.id)) }} onChange={event => setSelectedIds(previous => event.target.checked ? [...new Set([...previous, ...matchingEligible.map(entry => entry.id)])] : previous.filter(id => !matchingEligible.some(entry => entry.id === id)))} className="size-4 accent-orange-700" /></th>}
              <th className="px-4 py-2 font-medium">Contractor</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Hours</th>
              <th className="sticky right-0 z-[2] w-10 bg-card px-2 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry,index) => {
              const own = !!userEmail && entry.ownerEmail?.toLowerCase() === userEmail.toLowerCase()
              const unlocked = !entry.payoutEligible && (entry.status === "draft" || entry.status === "rejected" || (canReview && !own))
              const previous = visibleEntries[index - 1]
              const showIdentity = !previous || previous.project !== entry.project || previous.date !== entry.date || previous.contractor !== entry.contractor || previous.ownerEmail !== entry.ownerEmail
              return (
                <Fragment key={entry.id}>
              {groupBy!=="none"&&(index===0||entryGroupKey(visibleEntries[index-1],groupBy)!==entryGroupKey(entry,groupBy))&&<tr className="bg-gradient-to-r from-orange-50 via-sky-50 to-emerald-50"><th colSpan={selectable ? 8 : 7} className="border-y border-orange-100 px-3 py-2 text-left text-sm text-slate-900">{entryGroupLabel(entry,groupBy)} · {groupTotals.get(entryGroupKey(entry,groupBy))?.count} entries · {groupTotals.get(entryGroupKey(entry,groupBy))?.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h</th></tr>}
                <EntryLogRow entry={entry} showIdentity={showIdentity}
                  selection={selectable ? { checked: selectedIdSet.has(entry.id) && eligibleIdSet.has(entry.id), disabled: !eligibleIdSet.has(entry.id), onChange: checked => setSelectedIds(previous => checked ? [...new Set([...previous, entry.id])] : previous.filter(id => id !== entry.id)) } : undefined}
                  canEdit={canEdit && unlocked} canDelete={canDelete && unlocked}
                  canSubmit={canSubmit && (own||canSubmitOthers) && isEntrySubmissionOpen(entry,own)} canRecall={canSubmit && own} canReview={canReview && !own}
                  onUpdate={onUpdate} onStatusChange={onStatusChange} onDelete={onDelete}
                  onSubmit={canSubmit&&own?()=>{setSelectedIds([entry.id]);setSubmissionRequest(value=>value+1)}:undefined}
                  onRequestReview={onRequestReview&&requestable.some(row=>row.id===entry.id)?()=>onRequestReview([entry]):undefined}
                  onReview={(entry, decision) => setReview({ entry, decision })} />
                </Fragment>
              )
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-card">
            <tr className="bg-muted/40">
              <td
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                colSpan={selectable ? 6 : 5}
              >
                Total
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold tabular-nums">
                {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}h
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  )
}
