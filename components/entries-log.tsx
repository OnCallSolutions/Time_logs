"use client"

/**
 * Provides the editable entries table used for personal, team, and approval logs.
 *
 * This component is shared by regular users, managers, and administrators. Its
 * props control whether the table describes personal or team data, whether status
 * workflow controls are available, and whether elevated bulk clearing controls
 * should be available.
 */
import { FilterX, Search, ClipboardList, Trash2 } from "lucide-react"
import { Fragment,useEffect,useState } from "react"
import { EntryLogRow, type EntryMutation, type EntryTransition } from "@/components/entry-log-row"
import { EntryReviewDialog } from "@/components/manager-workspace"
import { SubmissionActions } from "@/components/submission-actions"
import { Button } from "@/components/ui/button"
import type { EntryStatus, TimeEntry } from "@/lib/types"

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
  canReview = false,
  canSubmit = false,
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
  canReview?: boolean
  canSubmit?: boolean
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
  const [review, setReview] = useState<{ entry: TimeEntry; decision: "approved" | "rejected" } | null>(null)
  useEffect(()=>{if(!canReview)setReview(null)},[canReview])
  const visibleEntries = entries.filter(entry =>
    (status === "all" || entry.status === status) &&
    [entry.contractor, entry.project, entry.description, entry.date].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a,b)=>a.project.localeCompare(b.project)||a.date.localeCompare(b.date)||(a.ownerEmail??a.contractor).localeCompare(b.ownerEmail??b.contractor)||a.contractor.localeCompare(b.contractor))
  const selectable = (canSubmit || canRequestReview) && !!userEmail
  const selectedIdSet = new Set(selectedIds)
  const visibleIdSet = new Set(visibleEntries.map(entry => entry.id))
  const submissions = canSubmit&&userEmail ? entries.filter(entry => entry.ownerEmail?.toLowerCase() === userEmail.toLowerCase() && !entry.payoutEligible && (entry.status === "draft" || entry.status === "rejected")) : []
  const requestable = canRequestReview ? entries.filter(entry=>entry.status==="submitted"&&(entry.reviewEligible||entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())) : []
  const eligible = [...submissions,...requestable]
  const eligibleIdSet = new Set(eligible.map(entry => entry.id))
  const selected = eligible.filter(entry => selectedIdSet.has(entry.id))
  const matchingEligible = eligible.filter(entry => visibleIdSet.has(entry.id))
  const allMatchingSelected = matchingEligible.length > 0 && matchingEligible.every(entry => selectedIdSet.has(entry.id))
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ClipboardList className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">No entries yet</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground text-pretty">
          Extract some notes above and the parsed time entries will show up here,
          ready to review and edit.
        </p>
      </div>
    )
  }

  const total = visibleEntries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0)

  return (
    <div className="overflow-hidden border-y border-border bg-card">
      {review && <EntryReviewDialog entry={review.entry} decision={review.decision} onCancel={() => setReview(null)} onConfirm={async note => {
        await onStatusChange(review.entry.id, review.decision, note || undefined, review.entry.revision)
        setReview(null)
      }} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
            {description}
          </p>
        </div>
        {canClear && (
          <Button variant="destructive" size="sm" onClick={onClear}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Clear all
          </Button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input aria-label="Search entries" placeholder="Search entries" value={query} onChange={event => setQuery(event.target.value)} className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <select aria-label="Filter entry status" value={status} onChange={event => setStatus(event.target.value as EntryStatus | "all")} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="all">All statuses</option>
            {(["draft", "submitted", "approved", "rejected"] as const).map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </select>
          <Button variant="outline" size="icon-sm" title="Reset filters" aria-label="Reset filters" disabled={!query && status === "all"} onClick={() => { setQuery(""); setStatus("all") }}><FilterX className="size-4" /></Button>
          <span className="text-xs text-muted-foreground">{visibleEntries.length} of {entries.length}</span>
        </div>
        {selectable && <div aria-label="Entry submission controls" className="flex flex-wrap items-center gap-2 border-b bg-orange-50/50 p-3">
          <Button variant="outline" size="sm" disabled={!eligible.length} onClick={() => setSelectedIds(eligible.map(entry => entry.id))}>Select all eligible ({eligible.length})</Button>
          <Button variant="ghost" size="sm" disabled={!selected.length} onClick={() => setSelectedIds([])}>Clear selection</Button>
          <span className="text-sm">{selected.length} selected / {matchingEligible.length} matching eligible</span>
          {canSubmit&&<SubmissionActions entries={submissions.filter(entry=>selectedIdSet.has(entry.id))} openRequest={submissionRequest} destination={submissionDestination} onStatusChange={onStatusChange} onSubmitted={id => setSelectedIds(previous => previous.filter(current => current !== id))} />}
          {canRequestReview&&onRequestReview&&<Button size="sm" variant="outline" disabled={!requestable.some(entry=>selectedIdSet.has(entry.id))||requestable.filter(entry=>selectedIdSet.has(entry.id)).length>50} onClick={()=>onRequestReview(requestable.filter(entry=>selectedIdSet.has(entry.id)))}>Request reviewer help ({requestable.filter(entry=>selectedIdSet.has(entry.id)).length})</Button>}
        </div>}
        {visibleEntries.length === 0 && <p role="status" className="p-4 text-sm text-muted-foreground">No matching entries.</p>}
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
                {(index===0||visibleEntries[index-1].project!==entry.project)&&<tr className="bg-orange-50"><th colSpan={selectable ? 8 : 7} className="px-3 py-2 text-left text-sm">Project: {entry.project} / {visibleEntries.filter(row=>row.project===entry.project).length} entries / {visibleEntries.filter(row=>row.project===entry.project).reduce((sum,row)=>sum+row.hours,0)}h</th></tr>}
                <EntryLogRow entry={entry} showIdentity={showIdentity}
                  selection={selectable ? { checked: selectedIdSet.has(entry.id) && eligibleIdSet.has(entry.id), disabled: !eligibleIdSet.has(entry.id), onChange: checked => setSelectedIds(previous => checked ? [...new Set([...previous, entry.id])] : previous.filter(id => id !== entry.id)) } : undefined}
                  canEdit={canEdit && unlocked} canDelete={canDelete && unlocked}
                  canSubmit={canSubmit && (!userEmail || own)} canReview={canReview && !own}
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
