/**
 * Renders a stable entry row with an isolated, explicit editing transaction.
 * Typing never persists data; Save awaits confirmation and Cancel discards drafts.
 * Each grouped work unit retains its own revision, status, and review controls.
 */
"use client"

import { Fragment, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ClipboardList, Pencil, Save, Send, Trash2, UserPlus, X, XCircle } from "lucide-react"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import type { EntryStatus, TimeEntry } from "@/lib/types"

export type EntryMutation = (id: string, patch: Partial<TimeEntry>, revision?: string) => void | Promise<void>
export type EntryTransition = (id: string, status: EntryStatus, note?: string, revision?: string, manager?: string) => void | Promise<void>

const statusStyles: Record<EntryStatus, string> = {
  draft: "border-zinc-200 bg-zinc-50 text-zinc-700",
  submitted: "border-blue-200 bg-blue-50 text-blue-800",
  approved: "border-green-200 bg-green-50 text-green-800",
  rejected: "border-red-200 bg-red-50 text-red-800",
}
const statusRowStyles:Record<EntryStatus,string>={
  draft:"border-l-4 border-l-slate-400 bg-slate-50/70 hover:bg-orange-100",
  submitted:"border-l-4 border-l-blue-500 bg-blue-50/45 hover:bg-blue-100",
  approved:"border-l-4 border-l-emerald-500 bg-emerald-50/45 hover:bg-emerald-100",
  rejected:"border-l-4 border-l-red-500 bg-red-50/45 hover:bg-red-100",
}

/**
 * Keeps editable strings local until a validated Save is confirmed by the server.
 * @param props.entry - Persisted work unit, never mutated during typing.
 * @param props.showIdentity - Whether this row starts a person/day/project cluster.
 * @param props.canEdit - Whether the current entry is editable.
 * @param props.canDelete - Whether this entry can be removed.
 * @param props.canSubmit - Whether submission and recall controls are available.
 * @param props.canReview - Whether independent review controls are available.
 * @param props.onUpdate - Awaitable, revision-bound persistence callback.
 * @param props.onStatusChange - Awaitable workflow transition callback.
 * @param props.onDelete - Existing removal callback.
 * @param props.onReview - Opens an explicit approval/rejection dialog.
 * @param props.selection - Optional controlled selection for an owned eligible row.
 * @returns JSX.Element containing the row and any local validation/error feedback.
 */
export function EntryLogRow({ entry, showIdentity, canEdit, canDelete, canSubmit, canRecall = canSubmit, canReview, onUpdate, onStatusChange, onDelete, onReview, selection, onRequestReview, onSubmit }: {
  entry: TimeEntry; showIdentity: boolean; canEdit: boolean; canDelete: boolean; canSubmit: boolean; canRecall?: boolean; canReview: boolean;
  onUpdate: EntryMutation; onStatusChange: EntryTransition; onDelete: (id: string) => void;
  onReview: (entry: TimeEntry, decision: "approved" | "rejected") => void;
  selection?: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void };
  onRequestReview?: () => void;
  onSubmit?: () => void;
}) {
  const [draft, setDraft] = useState<(Omit<TimeEntry, "hours"> & { hours: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const pending = useRef(false)
  const editing = !!draft && canEdit
  const inputClass = "w-full min-w-24 rounded-md border border-sky-200 bg-white px-2 py-2 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-200"

  /**
   * Saves one snapshot or performs a status transition without duplicate requests.
   * @param action - Awaitable operation; rejection leaves the draft intact.
   * @returns Promise<void> after success or a visible local error.
   */
  async function perform(action: () => void | Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError("")
    try { await action() } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The entry could not be updated.")
    } finally { pending.current = false; setBusy(false) }
  }

  /**
   * Validates the complete local draft and persists only editable fields.
   * @returns Promise<void> after confirmed Save; errors preserve the local input.
   */
  async function save(): Promise<void> {
    if (!draft || !canEdit) return
    const hours = Number(draft.hours)
    if (!draft.contractor.trim() || !draft.project.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !draft.hours.trim() || !Number.isFinite(hours) || hours < 0) {
      setError("Enter a name, project, valid date, and non-negative hours.")
      return
    }
    await perform(async () => {
      await onUpdate(entry.id, { contractor: draft.contractor.trim(), date: draft.date, project: draft.project.trim(), description: draft.description, hours }, draft.revision)
      setDraft(null)
    })
  }

  /**
   * Aborts an unsaved draft and restores the persisted row without a request.
   * @returns void; pending requests prevent dismissal.
   */
  function cancel(): void {
    if (pending.current) return
    setDraft(null)
    setError("")
  }

  return <Fragment>
    {deleteConfirmationOpen && <WindowSurface title="Confirm entry deletion" onBack={() => setDeleteConfirmationOpen(false)} compact resizable>
      <section className="flex w-full max-w-xl flex-col bg-white text-slate-950">
        <header className="flex items-start gap-3 border-b border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
          <div><h2 className="font-semibold text-red-950">Delete this timesheet entry?</h2><p className="mt-1 text-sm text-red-900">This permanently removes the selected record. This cannot be undone.</p></div>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 p-4 text-sm">
          <dt className="font-medium text-slate-500">Project</dt><dd className="break-words">{entry.project}</dd>
          <dt className="font-medium text-slate-500">Date</dt><dd>{entry.date}</dd>
          <dt className="font-medium text-slate-500">Work</dt><dd className="break-words">{entry.description || "No description"}</dd>
          <dt className="font-medium text-slate-500">Hours</dt><dd>{entry.hours}h</dd>
        </dl>
        <footer className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => setDeleteConfirmationOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { setDeleteConfirmationOpen(false); onDelete(entry.id) }}><Trash2 className="size-4" />Delete entry</Button>
        </footer>
      </section>
    </WindowSurface>}
    <tr className={`border-b border-slate-300 align-top transition-colors duration-100 ${statusRowStyles[entry.status]} ${selection?.checked?"!bg-cyan-100 shadow-[inset_0_0_0_2px_#0891b2]":""}`} aria-selected={selection?.checked||undefined} aria-label={`Entry ${entry.description || entry.id}`}>
      {selection && <td className="px-1.5 py-1"><input type="checkbox" aria-label={`Select entry ${entry.id}`} checked={selection.checked} disabled={selection.disabled || busy} onChange={event => selection.onChange(event.target.checked)} className="size-3.5 accent-orange-700" /></td>}
      <td className="px-1.5 py-1">{showIdentity && <><span className="text-xs font-medium">{entry.contractor}</span>{entry.contractorNumber&&<span title={entry.contractorNumber} className="mt-0.5 block max-w-48 break-all font-mono text-[10px] text-muted-foreground">{entry.shortReference || entry.contractorNumber}</span>}{entry.employeeId&&<span className="block text-[10px] text-muted-foreground">Employee ID: {entry.employeeId}</span>}</>}</td>
      <td className="px-1.5 py-1">{showIdentity && <span className="whitespace-nowrap font-mono text-xs">{entry.date}</span>}</td>
      <td className="px-1.5 py-1"><span className="text-xs">{showIdentity?entry.project:""}</span></td>
      <td className="min-w-40 px-1.5 py-1"><p className="whitespace-pre-wrap break-words text-xs leading-4">{entry.description}</p>{error && !editing && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}</td>
      <td className="px-1.5 py-1"><span className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-4 ${statusStyles[entry.status]}`}>{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}</span>{entry.reviewManagerEmail&&<p className="mt-0.5 max-w-48 break-words text-[10px] leading-3 text-sky-800">Approver: {entry.reviewManagerName||entry.reviewManagerEmail}</p>}{entry.reviewNote && <p className="mt-1 max-w-48 break-words text-[10px] leading-3">{entry.reviewNote}</p>}{entry.reviewedBy && <p className="mt-0.5 max-w-48 break-words text-[10px] text-muted-foreground">Approved by {entry.reviewedByName||entry.reviewedBy}</p>}</td>
      <td className="px-1.5 py-1 text-right"><span className="text-xs tabular-nums">{entry.hours}h</span></td>
      <td className="sticky right-0 border-l border-l-slate-400 bg-inherit px-1 py-1"><div className="flex justify-end gap-0.5">
        {canEdit && <Button size="icon-sm" className="size-7" variant="outline" title="Edit entry" aria-label="Edit entry" disabled={busy} onClick={() => { setDraft({ ...entry, hours: String(entry.hours) }); setError("") }}><Pencil className="size-3.5" /></Button>}
        {canSubmit && (entry.status === "draft" || entry.status === "rejected") && <Button size="icon-sm" className="size-7" variant="outline" title="Submit entry" aria-label="Submit entry" disabled={busy} onClick={() => onSubmit ? onSubmit() : void perform(() => onStatusChange(entry.id, "submitted", undefined, entry.revision))}><Send className="size-3.5" /></Button>}
        {onRequestReview && <Button size="icon-sm" className="size-7" variant="outline" title="Request reviewer help" aria-label="Request reviewer help" disabled={busy} onClick={onRequestReview}><UserPlus className="size-3.5" /></Button>}
        {canRecall && entry.status === "submitted" && <Button size="icon-sm" className="size-7" variant="outline" title="Recall entry to draft" aria-label="Recall entry to draft" disabled={busy} onClick={() => void perform(() => onStatusChange(entry.id, "draft", undefined, entry.revision))}><ClipboardList className="size-3.5" /></Button>}
        {canReview && entry.reviewEligible !== false && entry.status === "submitted" && <><Button size="icon-sm" className="size-7" variant="outline" title={entry.approvalEligible===false?"Approval requires business-account forwarding permission":"Approve entry"} aria-label="Approve entry" disabled={busy||entry.approvalEligible===false} onClick={() => onReview(entry, "approved")}><CheckCircle2 className="size-3.5" /></Button><Button size="icon-sm" className="size-7" variant="outline" title="Reject entry" aria-label="Reject entry" disabled={busy} onClick={() => onReview(entry, "rejected")}><XCircle className="size-3.5" /></Button></>}
        {canDelete&&<Button size="icon-sm" className="size-7" variant="ghost" title="Delete entry" aria-label="Delete entry" disabled={busy} onClick={() => setDeleteConfirmationOpen(true)}><Trash2 className="size-3.5" /></Button>}
      </div></td>
    </tr>
    {editing && <WindowSurface title="Edit time entry" disabled={busy} onBack={cancel}>
      <form noValidate onSubmit={event => { event.preventDefault(); void save() }} className="flex min-h-0 w-full flex-col bg-gradient-to-br from-sky-50 via-white to-emerald-50">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-gradient-to-r from-sky-100 via-white to-emerald-100 px-4 py-2.5">
          <div><h2 className="text-base font-semibold text-sky-950">Edit time entry</h2><p className="text-xs text-slate-600">Update the record, then save your changes.</p></div>
          <div className="flex items-center gap-2"><Button type="button" variant="outline" title="Cancel edit" aria-label="Cancel edit" disabled={busy} onClick={cancel}><X className="size-4"/>Cancel</Button><Button type="submit" title="Save entry" aria-label="Save entry" disabled={busy} className="bg-emerald-700 text-white hover:bg-emerald-800"><Save className="size-4"/>{busy?"Saving...":"Save"}</Button></div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 rounded-md border border-sky-100 bg-white/85 p-4 shadow-sm sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">Contractor<input autoFocus aria-label="Contractor" className={inputClass + " mt-1"} value={draft.contractor} disabled={busy} onChange={event => setDraft({ ...draft, contractor: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Project<input aria-label="Project" className={inputClass + " mt-1"} value={draft.project} disabled={busy} onChange={event => setDraft({ ...draft, project: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Date<input type="date" aria-label="Date" className={inputClass + " mt-1"} value={draft.date} disabled={busy} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Hours<input type="number" step="any" min="0" aria-label="Hours" className={inputClass + " mt-1"} value={draft.hours} disabled={busy} onChange={event => setDraft({ ...draft, hours: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium sm:col-span-2">Description<textarea aria-label="Description" className={inputClass + " mt-1 min-h-40 resize-y"} value={draft.description} disabled={busy} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
            {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          </div>
        </div>
      </form>
    </WindowSurface>}
  </Fragment>
}
