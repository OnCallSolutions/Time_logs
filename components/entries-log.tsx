"use client"

/**
 * Provides the editable entries table used for personal, team, and approval logs.
 *
 * This component is shared by regular users, managers, and administrators. Its
 * props control whether the table describes personal or team data, whether status
 * workflow controls are available, and whether elevated bulk clearing controls
 * should be available.
 */
import { AlertTriangle, ChevronRight, Download, Eye, FileJson2, FileSpreadsheet, FileText, FilterX, Search, ClipboardList, Trash2 } from "lucide-react"
import { Fragment,useEffect,useState,type ReactNode } from "react"
import { EntryLogRow, type EntryMutation, type EntryTransition } from "@/components/entry-log-row"
import { EntryReviewDialog } from "@/components/manager-workspace"
import { SubmissionActions } from "@/components/submission-actions"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import { downloadTimesheetExport,type TimesheetExportFormat } from "@/lib/timesheet-export"
import { useRetainedViewState } from "@/components/use-retained-view-state"
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
  deleteOwnOnly = false,
  canClear = false,
  canExport = false,
  canReview = false,
  canSubmit = false,
  canSubmitOthers = false,
  readOnlyArchivedForOwner = false,
  periodView = false,
  initialPeriodSelection,
  periodToolbarCenter,
  showPatronBulkActions=false,
  refreshKey=0,
  hideHeader = false,
  description = "Review your saved entries.",
  entries,
  onUpdate,
  onStatusChange,
  onDelete,
  onClear,
  title = "Time entries",
  stateKey,
}: {
  userEmail?: string
  submissionDestination?: "manager" | "account_manager" | "self"
  canRequestReview?: boolean
  onRequestReview?: (entries: TimeEntry[]) => void
  canEdit?: boolean
  canDelete?: boolean
  deleteOwnOnly?: boolean
  canClear?: boolean
  canExport?: boolean
  canReview?: boolean
  canSubmit?: boolean
  canSubmitOthers?: boolean
  readOnlyArchivedForOwner?: boolean
  periodView?: boolean
  initialPeriodSelection?: string
  periodToolbarCenter?: ReactNode
  showPatronBulkActions?: boolean
  refreshKey?: number
  hideHeader?: boolean
  description?: string
  entries: TimeEntry[]
  onUpdate: EntryMutation
  onStatusChange: EntryTransition
  onDelete: (id: string) => void
  onClear: () => void
  title?: string
  stateKey?: string
}) {
  const [query, setQuery] = useRetainedViewState(stateKey?`${stateKey}:query`:undefined,"")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [exportMenuOpen,setExportMenuOpen]=useState(false)
  const [exportError,setExportError]=useState("")
  const [exportPreviewOpen,setExportPreviewOpen]=useState(false)
  const [exportFormat,setExportFormat]=useState<TimesheetExportFormat>("xlsx")
  const [exportBusy,setExportBusy]=useState(false)
  const [exportPreviewError,setExportPreviewError]=useState("")
  const [submissionRequest,setSubmissionRequest]=useState(0)
  const [status, setStatus] = useRetainedViewState<EntryStatus | "all">(stateKey?`${stateKey}:status`:undefined,`all`)
  const [project, setProject] = useRetainedViewState(stateKey?`${stateKey}:project`:undefined,`all`)
  const [dateFrom, setDateFrom] = useRetainedViewState(stateKey?`${stateKey}:from`:undefined,"")
  const [dateThrough, setDateThrough] = useRetainedViewState(stateKey?`${stateKey}:through`:undefined,"")
  const [sortBy, setSortBy] = useRetainedViewState(stateKey?`${stateKey}:sort`:undefined,`date_newest`)
  const [groupBy, setGroupBy] = useRetainedViewState(stateKey?`${stateKey}:group`:undefined,`project`)
  const [review, setReview] = useState<{ entry: TimeEntry; decision: "approved" | "rejected" } | null>(null)
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false)
  const [submissionDeadline,setSubmissionDeadline]=useState<string|null>(null)
  const [periods,setPeriods]=useState<Array<{id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;managerGraceDays:number}>>([])
  const [extensionRequests,setExtensionRequests]=useState<Array<{periodId:string;status:string;approvedUntil:string|null}>>([])
  const [periodSelection,setPeriodSelection]=useRetainedViewState(stateKey?`${stateKey}:period`:undefined,`current`)
  useEffect(()=>{if(initialPeriodSelection)setPeriodSelection(initialPeriodSelection)},[initialPeriodSelection,setPeriodSelection])
  const [periodsLoaded,setPeriodsLoaded]=useState(false)
  const [deadlineLoaded,setDeadlineLoaded]=useState(false)
  useEffect(()=>{if(!canReview)setReview(null)},[canReview])
  useEffect(()=>{
    if(!canSubmit&&!periodView){setDeadlineLoaded(false);return}
    const controller=new AbortController()
    fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(response.ok)setPeriods(data.periods??[])
      if(canSubmit){const extensionResponse=await fetch(apiPath("/api/submission-extensions"),{cache:"no-store",signal:controller.signal});const extensionData=await extensionResponse.json();if(extensionResponse.ok)setExtensionRequests(extensionData.requests??[])}
      if(response.ok&&!(data.periods??[]).length){const legacy=await fetch(apiPath("/api/submission-deadline"),{cache:"no-store",signal:controller.signal});const boundary=await legacy.json();if(legacy.ok)setSubmissionDeadline(boundary.deadline??null)}
    }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted){setDeadlineLoaded(true);setPeriodsLoaded(true)}})
    return()=>controller.abort()
  },[canSubmit,periodView,refreshKey])
  const now=Date.now()
  const todayDate=new Date()
  const today=[todayDate.getFullYear(),String(todayDate.getMonth()+1).padStart(2,"0"),String(todayDate.getDate()).padStart(2,"0")].join("-")
  const activePeriod=periods.find(period=>period.startDate<=today&&period.endDate>=today)
  const selectedPeriod=periodSelection==="current"?activePeriod:periods.find(period=>period.id===periodSelection)
  const hasExtensionForEntry=(entry:TimeEntry)=>extensionRequests.some(request=>request.status==="approved"&&!!request.approvedUntil&&now<=Date.parse(request.approvedUntil)&&periods.some(period=>period.id===request.periodId&&entry.date>=period.startDate&&entry.date<=period.endDate))
  const ownerEntryIsArchived=(entry:TimeEntry)=>readOnlyArchivedForOwner&&(!periodsLoaded||periods.some(period=>period.endDate<today&&entry.date>=period.startDate&&entry.date<=period.endDate))
  const periodEntries=!periodView?entries:!periodsLoaded?[]:periods.length===0?entries:periodSelection==="current"?(activePeriod?entries.filter(entry=>entry.date>=activePeriod.startDate&&entry.date<=activePeriod.endDate):[]):periodSelection==="archived"?entries.filter(entry=>periods.some(period=>period.endDate<today&&entry.date>=period.startDate&&entry.date<=period.endDate)):periodSelection==="all"?entries:periodSelection==="unassigned"?entries.filter(entry=>!periods.some(period=>entry.date>=period.startDate&&entry.date<=period.endDate)):entries.filter(entry=>{const period=periods.find(candidate=>candidate.id===periodSelection);return !!period&&entry.date>=period.startDate&&entry.date<=period.endDate})
  const isEntrySubmissionOpen=(entry:TimeEntry,own:boolean)=>{
    if(periods.length){
      const period=periods.find(candidate=>entry.date>=candidate.startDate&&entry.date<=candidate.endDate)
      if(!period)return false
      const deadline=Date.parse(period.submissionDeadline)
      if(now<=deadline)return true
      if(hasExtensionForEntry(entry))return true
      return canSubmitOthers&&now<=deadline+period.managerGraceDays*86_400_000
    }
    return !submissionDeadline||now<Date.parse(submissionDeadline)
  }
  const displayedDeadline=periods.length?(selectedPeriod?.submissionDeadline??null):submissionDeadline
  const submissionClosed=!!displayedDeadline&&Date.parse(displayedDeadline)<=now
  const deadlineLabel=displayedDeadline?new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(displayedDeadline)):null
  const deadlineMessage=displayedDeadline
    ? `${selectedPeriod?`${selectedPeriod.name} · `:""}Submit by ${deadlineLabel}${submissionClosed?" · deadline passed":""}.`
    : periods.length&&periodView&&(periodSelection==="all"||periodSelection==="archived"||periodSelection==="unassigned")
      ? "Select a specific timesheet period to view its submission deadline."
      : deadlineLoaded?"No submission deadline is configured for this period.":"Checking submission deadline..."
  const visibleEntries = periodEntries.filter(entry =>
    (status === "all" || entry.status === status) &&
    (project === "all" || entry.project === project) &&
    (!dateFrom || entry.date >= dateFrom) &&
    (!dateThrough || entry.date <= dateThrough) &&
    [entry.contractor, entry.project, entry.description, entry.date, entry.status,entry.reviewManagerName,entry.reviewManagerEmail,entry.reviewedByName,entry.reviewedBy].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a,b)=>compareEntries(a,b,sortBy,groupBy))
  const selectable = (canSubmit || canSubmitOthers || canRequestReview) && !!userEmail
  const selectedIdSet = new Set(selectedIds)
  const visibleIdSet = new Set(visibleEntries.map(entry => entry.id))
  const submissions = canSubmit&&userEmail ? periodEntries.filter(entry => (!ownerEntryIsArchived(entry)||hasExtensionForEntry(entry)) && !entry.payoutEligible && (entry.status === "draft" || entry.status === "rejected") && (entry.ownerEmail?.toLowerCase() === userEmail.toLowerCase() || canSubmitOthers) && isEntrySubmissionOpen(entry,entry.ownerEmail?.toLowerCase()===userEmail.toLowerCase())) : []
  const requestable = canRequestReview ? periodEntries.filter(entry=>entry.status==="submitted"&&(entry.reviewEligible||entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())) : []
  const eligible = [...submissions,...requestable]
  const eligibleIdSet = new Set(eligible.map(entry => entry.id))
  const selected = eligible.filter(entry => selectedIdSet.has(entry.id))
  const matchingEligible = eligible.filter(entry => visibleIdSet.has(entry.id))
  const allMatchingSelected = matchingEligible.length > 0 && matchingEligible.every(entry => selectedIdSet.has(entry.id))
  if (entries.length === 0) {
    return (
      <div className="border-y border-border bg-card/50">
      {periodView?<div className="timesheet-period-toolbar-container min-w-0 border-b border-indigo-300 bg-indigo-100/80 px-2.5 py-1.5"><div className="timesheet-period-toolbar items-center gap-1"><span role="status" className={`timesheet-period-deadline text-left text-xs font-semibold ${submissionClosed?"text-red-950":"text-orange-950"}`}>{deadlineMessage}</span>{periodToolbarCenter&&<div className="timesheet-period-center min-w-0">{periodToolbarCenter}</div>}</div></div>:canSubmit&&<p role="status" className={`border-b px-4 py-2 text-xs ${submissionClosed?"border-red-200 bg-red-50 text-red-900":"border-orange-200 bg-orange-50/70 text-orange-950"}`}>{deadlineMessage}</p>}
      {canExport&&<div className="flex justify-end border-b border-slate-200 bg-white px-3 py-1.5"><Button variant="outline" size="sm" className="h-7 border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-900" disabled aria-label="Export timesheets"> <Download className="size-3.5" aria-hidden="true"/>Export (0)</Button></div>}
      <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
        {!hideHeader&&<div className="mb-6 w-full max-w-3xl text-left">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">0 entries · {description}</p>
        </div>}
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
  const exportPeriodLabel=periodView
    ?selectedPeriod?`${selectedPeriod.name} (${selectedPeriod.startDate} to ${selectedPeriod.endDate})`
      :periodSelection==="all"?"All saved periods"
      :periodSelection==="archived"?"Archived periods"
      :periodSelection==="unassigned"?"Dates outside configured periods"
      :periodSelection==="current"?"Current period"
      :periods.find(period=>period.id===periodSelection)?.name
    :undefined
  const exportView={
    period:exportPeriodLabel,
    search:query.trim()||undefined,
    status:status==="all"?undefined:status,
    project:project==="all"?undefined:project,
    dateFrom:dateFrom||undefined,
    dateThrough:dateThrough||undefined,
    sortBy,
    groupBy:groupBy as "project"|"day"|"person"|"none",
  }
  const exportViewDescription=[
    exportView.period&&`Period: ${exportView.period}`,
    exportView.search&&`Search: ${exportView.search}`,
    exportView.status&&`Status: ${exportView.status}`,
    exportView.project&&`Project: ${exportView.project}`,
    (exportView.dateFrom||exportView.dateThrough)&&`Dates: ${exportView.dateFrom||"any"} to ${exportView.dateThrough||"any"}`,
    `Sort: ${sortBy}`,
    `Group: ${groupBy}`,
  ].filter(Boolean).join(" · ")||"All entries"
  const exportPreviewRows=visibleEntries.slice(0,20)
  const downloadFormat=(format:TimesheetExportFormat)=>{
    setExportMenuOpen(false)
    setExportError("")
    setExportBusy(true)
    void downloadTimesheetExport(visibleEntries,format,exportView)
      .catch(()=>setExportError("The file could not be generated. Try again or use the preview."))
      .finally(()=>setExportBusy(false))
  }

  return (
    <div className="timesheet-workspace-frame flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-gradient-to-b from-white to-sky-50/30 shadow-sm">
      {exportPreviewOpen&&<WindowSurface title="Timesheet export preview" onBack={()=>{if(!exportBusy)setExportPreviewOpen(false)}} disabled={exportBusy} assistant={false}>
        <section className="flex h-full min-h-0 w-full flex-col bg-white text-slate-950">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-3">
            <div><h2 className="text-sm font-semibold">Export preview</h2><p className="text-xs text-slate-600">{visibleEntries.length} entries · {total.toLocaleString(undefined,{maximumFractionDigits:2})} total hours</p></div>
            <label className="flex items-center gap-2 text-xs font-medium">Format<select aria-label="Export format" value={exportFormat} onChange={event=>{setExportFormat(event.target.value as TimesheetExportFormat);setExportPreviewError("")}} disabled={exportBusy} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
              <option value="xlsx">Excel workbook (.xlsx)</option><option value="ods">OpenDocument spreadsheet (.ods)</option><option value="csv">CSV (.csv)</option><option value="json">JSON (.json)</option><option value="pdf-color">Color PDF (.pdf)</option><option value="pdf-grayscale">Black &amp; white PDF (.pdf)</option>
            </select></label>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
            <p className="mb-3 break-words text-xs text-slate-600">{exportViewDescription}</p>
            <div className="overflow-x-auto rounded border border-slate-300">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-900"><tr>{["Contractor","Date","Project","Description","Hours","Status"].map(label=><th key={label} className="border-b border-slate-300 px-2 py-2 font-semibold">{label}</th>)}</tr></thead>
                <tbody>{exportPreviewRows.map(entry=><tr key={entry.id} className="odd:bg-white even:bg-slate-50"><td className="border-b border-slate-200 px-2 py-2">{entry.contractor}</td><td className="border-b border-slate-200 px-2 py-2">{entry.date}</td><td className="border-b border-slate-200 px-2 py-2">{entry.project}</td><td className="max-w-xl whitespace-pre-wrap break-words border-b border-slate-200 px-2 py-2">{entry.description}</td><td className="border-b border-slate-200 px-2 py-2 text-right tabular-nums">{entry.hours}</td><td className="border-b border-slate-200 px-2 py-2 capitalize">{entry.status}</td></tr>)}</tbody>
                <tfoot className="bg-sky-100 font-semibold"><tr><td className="border-t-2 border-sky-400 px-2 py-2" colSpan={4}>TOTAL · {visibleEntries.length} {visibleEntries.length===1?"entry":"entries"}</td><td className="border-t-2 border-sky-400 px-2 py-2 text-right tabular-nums">{total.toLocaleString(undefined,{maximumFractionDigits:2})}h</td><td className="border-t-2 border-sky-400 px-2 py-2"/></tr></tfoot>
              </table>
            </div>
            {visibleEntries.length>exportPreviewRows.length&&<p className="mt-2 text-xs text-slate-600">Previewing {exportPreviewRows.length} of {visibleEntries.length} rows. The download includes every matching row.</p>}
            {exportPreviewError&&<p role="alert" className="mt-3 text-sm text-red-800">{exportPreviewError}</p>}
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white p-3">
            <Button variant="outline" disabled={exportBusy} onClick={()=>setExportPreviewOpen(false)}>Cancel</Button>
            <Button disabled={exportBusy||!visibleEntries.length} onClick={()=>{setExportBusy(true);setExportPreviewError("");void downloadTimesheetExport(visibleEntries,exportFormat,exportView).then(()=>setExportPreviewOpen(false)).catch(()=>setExportPreviewError("The file could not be generated. Try another format or retry.")).finally(()=>setExportBusy(false))}}><Download className="size-4"/>{exportBusy?"Preparing…":"Download"}</Button>
          </footer>
        </section>
      </WindowSurface>}
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
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-orange-200 bg-gradient-to-r from-orange-50 via-white to-sky-50 px-2.5 py-1.5">
        {!hideHeader&&<div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] text-muted-foreground">
            {periodEntries.length} {periodEntries.length === 1 ? "entry" : "entries"} ·{" "}
            {description}
          </p>
        </div>}
        <div className="flex flex-wrap items-center gap-1">
          {canClear&&<Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => setClearConfirmationOpen(true)}><Trash2 className="size-3.5" aria-hidden="true" />Clear all</Button>}
          {canExport&&<div className="relative">
            <Button variant="outline" size="sm" className="h-7 border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-900 hover:bg-emerald-100" disabled={!visibleEntries.length} aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={()=>setExportMenuOpen(open=>!open)}><Download className="size-3.5" aria-hidden="true"/>Export ({visibleEntries.length})</Button>
            {exportMenuOpen&&<div role="menu" aria-label="Timesheet export formats" className="absolute right-0 top-full z-30 mt-1 grid max-h-[min(70vh,24rem)] min-w-56 gap-0.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
              <p className="px-2 py-1 text-[11px] font-medium text-slate-600">Download current view · {visibleEntries.length} {visibleEntries.length===1?"entry":"entries"}</p>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("xlsx")}><FileSpreadsheet className="size-3.5" aria-hidden="true"/>Download Excel (.xlsx)</button>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("ods")}><FileSpreadsheet className="size-3.5" aria-hidden="true"/>Download OpenDocument (.ods)</button>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("csv")}><FileSpreadsheet className="size-3.5" aria-hidden="true"/>Download CSV (.csv)</button>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("json")}><FileJson2 className="size-3.5" aria-hidden="true"/>Download JSON (.json)</button>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("pdf-color")}><FileText className="size-3.5" aria-hidden="true"/>Download color PDF (.pdf)</button>
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>downloadFormat("pdf-grayscale")}><FileText className="size-3.5" aria-hidden="true"/>Download black & white PDF (.pdf)</button>
              <div className="my-1 border-t border-slate-200" />
              <button type="button" role="menuitem" disabled={exportBusy} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50" onClick={()=>{setExportPreviewError("");setExportFormat("xlsx");setExportMenuOpen(false);setExportPreviewOpen(true)}}><Eye className="size-3.5" aria-hidden="true"/>Preview and choose format…</button>
            </div>}
            {exportError&&<p role="alert" className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-red-200 bg-white p-2 text-xs text-red-800 shadow">{exportError}</p>}
          </div>}
        </div>
      </div>
      {periodView&&<div className="timesheet-period-toolbar-container min-w-0 border-b border-indigo-300 bg-indigo-100/80 px-2.5 py-1.5">
        <div className="timesheet-period-toolbar items-center gap-1">
        <span role="status" className={`timesheet-period-deadline text-left text-xs font-semibold ${submissionClosed?"text-red-950":"text-orange-950"}`}>{deadlineMessage}</span>
        {(periodToolbarCenter||(showPatronBulkActions&&canSubmit))&&<div className="timesheet-period-center min-w-0">{periodToolbarCenter??<div aria-label="Bulk timesheet submission" className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 whitespace-nowrap" disabled={!eligible.length} onClick={()=>setSelectedIds(eligible.map(entry=>entry.id))}>Select eligible ({eligible.length})</Button>
          <Button size="sm" variant="ghost" className="h-8 whitespace-nowrap" disabled={!selected.length} onClick={()=>setSelectedIds([])}>Clear ({selected.length})</Button>
          <SubmissionActions entries={submissions.filter(entry=>selectedIdSet.has(entry.id))} openRequest={submissionRequest} destination={submissionDestination} onStatusChange={onStatusChange} onSubmitted={id=>setSelectedIds(previous=>previous.filter(current=>current!==id))}/>
        </div>}</div>}
        <div className="timesheet-period-selector">
        <label className="timesheet-period-label text-xs font-bold text-indigo-950"><span>Timesheet period</span>
          <select aria-label="Timesheet period" value={periodSelection} onChange={event=>setPeriodSelection(event.target.value)} disabled={!periodsLoaded||periods.length===0} className="h-8 max-w-full rounded-md border-2 border-indigo-500 bg-white px-2 text-xs font-semibold text-indigo-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
            <option value="current">Current period{activePeriod?` · ${activePeriod.name}`:""}</option>
            <option value="archived">Archived periods · all</option>
            <option value="all">All saved periods</option>
            <option value="unassigned">Outside configured periods</option>
            {[...periods].sort((a,b)=>b.startDate.localeCompare(a.startDate)).map(period=><option key={period.id} value={period.id}>{period.startDate<=today&&period.endDate>=today?"Current":period.startDate>today?"Upcoming":"Archived"} · {period.name} ({period.startDate} – {period.endDate})</option>)}
          </select>
        </label>
        <span role="status" className="text-right text-xs font-semibold text-indigo-950">{!periodsLoaded?"Loading period history…":periods.length===0?"No periods are configured; showing all saved timesheets.":periodSelection==="current"&&!activePeriod?"No period is active today. Select an archived or upcoming period.":periodSelection==="archived"?"Archived entries remain stored and can be retrieved by period.":`Showing ${periodEntries.length} entries for ${periodSelection==="current"?activePeriod?.name??"the current period":periodSelection==="all"?"all periods":periodSelection==="unassigned"?"dates outside configured periods":periods.find(period=>period.id===periodSelection)?.name??"the selected period"}.`}</span>
        </div>
        </div>
      </div>}
      {canSubmit&&!periodView&&<p role="status" className={`border-b px-3 py-1.5 text-right text-xs font-semibold ${submissionClosed?"border-red-300 bg-red-100 text-red-950":"border-orange-300 bg-orange-100 text-orange-950"}`}>{deadlineMessage}</p>}

      <div className="mx-1 flex min-h-0 min-w-0 flex-1 flex-col border-b border-sky-200 bg-sky-50/50 p-1.5 sm:mx-2">
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-[minmax(20rem,1.55fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <label className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input aria-label="Search entries" placeholder="Search person, project, work, date" value={query} onChange={event => setQuery(event.target.value)} className="h-8 w-full min-w-0 rounded-md border border-sky-200 bg-white px-2.5 text-xs" />
          </label>
          <select aria-label="Filter entry status" value={status} onChange={event => setStatus(event.target.value as EntryStatus | "all")} className="h-8 rounded-md border border-blue-200 bg-white px-2 text-xs">
            <option value="all">All statuses</option>
            {(["draft", "submitted", "approved", "rejected"] as const).map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </select>
          <select aria-label="Filter entry project" value={project} onChange={event=>setProject(event.target.value)} className="h-8 min-w-0 rounded-md border border-orange-200 bg-white px-2 text-xs">
            <option value="all">All projects</option>{[...new Set(periodEntries.map(entry=>entry.project))].sort((a,b)=>a.localeCompare(b)).map(value=><option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="Sort entries" value={sortBy} onChange={event=>setSortBy(event.target.value)} className="h-8 rounded-md border border-violet-200 bg-white px-2 text-xs">
            <option value="date_newest">Newest date</option><option value="date_oldest">Oldest date</option><option value="project_az">Project A-Z</option><option value="person_az">Person A-Z</option><option value="hours_high">Hours: high to low</option><option value="hours_low">Hours: low to high</option><option value="status">Status</option>
          </select>
          <details aria-label="More timesheet controls" className="group relative z-20 min-w-0 sm:col-span-2 sm:justify-self-end xl:col-span-1">
            <summary className="flex h-8 cursor-pointer list-none items-center justify-center gap-1 whitespace-nowrap rounded-md border border-sky-300 bg-white px-2 text-xs font-medium text-sky-950 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 [&::-webkit-details-marker]:hidden"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true"/>More controls{filtersActive&&<span className="size-1.5 rounded-full bg-orange-600" aria-label="Custom filters active"/>}</summary>
            <div className="absolute right-0 top-full mt-1 grid w-[min(54rem,calc(100vw-1rem))] gap-1.5 rounded-md border border-sky-300 bg-white p-2 shadow-lg sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_minmax(14rem,1fr)_minmax(12rem,0.8fr)_auto]">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">From<input aria-label="Entries from date" type="date" value={dateFrom} max={dateThrough||undefined} onChange={event=>setDateFrom(event.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-2 text-xs"/></label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">Through<input aria-label="Entries through date" type="date" value={dateThrough} min={dateFrom||undefined} onChange={event=>setDateThrough(event.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-2 text-xs"/></label>
              <select aria-label="Group entries" value={groupBy} onChange={event=>setGroupBy(event.target.value)} className="h-7 rounded-md border border-teal-200 bg-white px-2 text-xs"><option value="project">Group by project</option><option value="day">Group by day</option><option value="person">Group by person</option><option value="none">No grouping</option></select>
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-600">{visibleEntries.length} visible · {filtersActive?"custom view":"all entries"}</span><Button variant="outline" size="sm" className="h-7" title="Reset search, filters, sorting, and grouping" aria-label="Reset timesheet view" disabled={!filtersActive} onClick={clearFilters}><FilterX className="size-4"/>Reset view</Button></div>
              {selectable&&!(showPatronBulkActions&&periodView)&&<div className="flex flex-wrap items-center gap-1 border-t border-orange-200 bg-orange-50/60 px-1.5 py-1 sm:col-span-2 xl:col-span-4">
                <span className="mr-1 text-xs font-semibold text-orange-950">Bulk actions · {selected.length} selected / {matchingEligible.length} eligible</span>
                <Button variant="outline" size="sm" disabled={!eligible.length} onClick={() => setSelectedIds(eligible.map(entry => entry.id))}>Select all eligible ({eligible.length})</Button>
                <Button variant="ghost" size="sm" disabled={!selected.length} onClick={() => setSelectedIds([])}>Clear selection</Button>
                {canSubmit&&<SubmissionActions entries={submissions.filter(entry=>selectedIdSet.has(entry.id))} openRequest={submissionRequest} destination={submissionDestination} onStatusChange={onStatusChange} onSubmitted={id => setSelectedIds(previous => previous.filter(current => current !== id))} />}
                {canRequestReview&&onRequestReview&&<Button size="sm" variant="outline" disabled={!requestable.some(entry=>selectedIdSet.has(entry.id))||requestable.filter(entry=>selectedIdSet.has(entry.id)).length>50} onClick={()=>onRequestReview(requestable.filter(entry=>selectedIdSet.has(entry.id)))}>Request reviewer help ({requestable.filter(entry=>selectedIdSet.has(entry.id)).length})</Button>}
              </div>}
            </div>
          </details>
        </div>
        {visibleEntries.length === 0 && <p role="status" className="p-4 text-sm text-muted-foreground">{periodView&&periodsLoaded&&periods.length>0&&periodSelection==="current"&&!activePeriod?"No timesheet period is active today. Select an archived or upcoming period to retrieve entries.":periodView&&periodsLoaded&&periods.length===0?"No saved timesheets match the current filters.":"No matching entries."}</p>}
        <div tabIndex={0} aria-label="Scrollable time entries" className="timesheet-scroll-region min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-scroll overscroll-y-auto rounded-sm border-2 border-slate-600 bg-white">
        <table className="w-full min-w-[1080px] border-collapse border-2 border-slate-500 text-left shadow-sm [&_th]:border-r [&_th]:border-slate-400 [&_td]:border-r [&_td]:border-b [&_td]:border-slate-300 [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0">
          <thead className="sticky top-0 z-[1] bg-sky-100">
            <tr className="border-b-2 border-sky-500 text-[10px] uppercase tracking-wide text-sky-950">
              {selectable && <th className="px-2 py-1"><input type="checkbox" aria-label="Select all matching eligible entries" checked={allMatchingSelected} disabled={!matchingEligible.length} ref={input => { if (input) input.indeterminate = !allMatchingSelected && matchingEligible.some(entry => selectedIds.includes(entry.id)) }} onChange={event => setSelectedIds(previous => event.target.checked ? [...new Set([...previous, ...matchingEligible.map(entry => entry.id)])] : previous.filter(id => !matchingEligible.some(entry => entry.id === id)))} className="size-3.5 accent-orange-700" /></th>}
              <th className="px-1.5 py-0.5 font-medium">Contractor</th>
              <th className="px-1.5 py-0.5 font-medium">Date</th>
              <th className="px-1.5 py-0.5 font-medium">Project</th>
              <th className="px-1.5 py-0.5 font-medium">Description</th>
              <th className="px-1.5 py-0.5 font-medium">Status</th>
              <th className="px-1.5 py-0.5 text-right font-medium">Hours</th>
              <th className="sticky right-0 z-[2] w-8 bg-card px-1 py-0.5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry,index) => {
              const own = !!userEmail && entry.ownerEmail?.toLowerCase() === userEmail.toLowerCase()
              const unlocked = !entry.payoutEligible && (entry.status === "draft" || entry.status === "rejected" || (canReview && !own))
              return (
                <Fragment key={entry.id}>
              {groupBy!=="none"&&(index===0||entryGroupKey(visibleEntries[index-1],groupBy)!==entryGroupKey(entry,groupBy))&&<tr className="bg-sky-100 text-sky-950"><th colSpan={selectable ? 8 : 7} className="border-y-2 border-sky-300 px-2 py-1 text-left text-xs font-semibold text-sky-950">{entryGroupLabel(entry,groupBy)} <span className="ml-1 font-normal text-sky-800">{groupTotals.get(entryGroupKey(entry,groupBy))?.count} entries · {groupTotals.get(entryGroupKey(entry,groupBy))?.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h</span></th></tr>}
                <EntryLogRow entry={entry} showIdentity
                  selection={selectable ? { checked: selectedIdSet.has(entry.id) && eligibleIdSet.has(entry.id), disabled: !eligibleIdSet.has(entry.id), onChange: checked => setSelectedIds(previous => checked ? [...new Set([...previous, entry.id])] : previous.filter(id => id !== entry.id)) } : undefined}
                  canEdit={canEdit && unlocked && !ownerEntryIsArchived(entry)} canDelete={canDelete && unlocked && (!deleteOwnOnly||own) && !ownerEntryIsArchived(entry)}
                  canSubmit={canSubmit && (own||canSubmitOthers) && (!ownerEntryIsArchived(entry)||hasExtensionForEntry(entry)) && isEntrySubmissionOpen(entry,own)} canRecall={canSubmit && own && !ownerEntryIsArchived(entry)} canReview={canReview && !own}
                  onUpdate={onUpdate} onStatusChange={onStatusChange} onDelete={onDelete}
                  onSubmit={canSubmit&&own?()=>{setSelectedIds([entry.id]);setSubmissionRequest(value=>value+1)}:undefined}
                  onRequestReview={onRequestReview&&requestable.some(row=>row.id===entry.id)?()=>onRequestReview([entry]):undefined}
                  onReview={(entry, decision) => setReview({ entry, decision })} />
                </Fragment>
              )
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-white">
            <tr className="border-t-2 border-emerald-300 bg-emerald-50">
              <td
                className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                colSpan={selectable ? 6 : 5}
              >
                Total
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
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
