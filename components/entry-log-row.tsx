/**
 * Renders a stable entry row with an isolated, explicit editing transaction.
 * Typing never persists data; Save awaits confirmation and Cancel discards drafts.
 * Each grouped work unit retains its own revision, status, and review controls.
 */
"use client"

import { Fragment, useRef, useState } from "react"
import { CheckCircle2, ClipboardList, Pencil, Save, Send, Trash2, UserPlus, X, XCircle } from "lucide-react"
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
export function EntryLogRow({ entry, showIdentity, canEdit, canDelete, canSubmit, canReview, onUpdate, onStatusChange, onDelete, onReview, selection, onRequestReview, onSubmit }: {
  entry: TimeEntry; showIdentity: boolean; canEdit: boolean; canDelete: boolean; canSubmit: boolean; canReview: boolean;
  onUpdate: EntryMutation; onStatusChange: EntryTransition; onDelete: (id: string) => void;
  onReview: (entry: TimeEntry, decision: "approved" | "rejected") => void;
  selection?: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void };
  onRequestReview?: () => void;
  onSubmit?: () => void;
}) {
  const [draft, setDraft] = useState<(Omit<TimeEntry, "hours"> & { hours: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const pending = useRef(false)
  const editing = !!draft && canEdit
  const inputClass = "w-full min-w-24 rounded-md border border-input bg-white px-2 py-2 text-sm focus:ring-2 focus:ring-orange-300"

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
    <tr className="border-b border-border/60 align-top hover:bg-muted/30" aria-label={`Entry ${entry.description || entry.id}`}>
      {selection && <td className="px-3 py-3"><input type="checkbox" aria-label={`Select entry ${entry.id}`} checked={selection.checked} disabled={selection.disabled || busy} onChange={event => selection.onChange(event.target.checked)} className="size-4 accent-orange-700" /></td>}
      <td className="px-3 py-3">{showIdentity && <span className="text-sm font-medium">{entry.contractor}</span>}</td>
      <td className="px-3 py-3">{showIdentity && <span className="whitespace-nowrap text-sm">{entry.date}</span>}</td>
      <td className="px-3 py-3">{showIdentity && <span className="text-sm">{entry.project}</span>}</td>
      <td className="min-w-48 px-3 py-3"><p className="whitespace-pre-wrap break-words text-sm">{entry.description}</p>{error && !editing && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}</td>
      <td className="px-3 py-3"><span className={`rounded border px-2 py-1 text-xs ${statusStyles[entry.status]}`}>{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}</span>{entry.reviewNote && <p className="mt-2 max-w-48 break-words text-xs">{entry.reviewNote}</p>}{entry.reviewedBy && <p className="mt-1 max-w-48 break-all text-xs text-muted-foreground">by {entry.reviewedBy}</p>}</td>
      <td className="px-3 py-3 text-right"><span className="text-sm tabular-nums">{entry.hours}h</span></td>
      <td className="sticky right-0 bg-card px-2 py-3"><div className="flex justify-end gap-1">
        {canEdit && <Button size="icon-sm" variant="outline" title="Edit entry" aria-label="Edit entry" disabled={busy} onClick={() => { setDraft({ ...entry, hours: String(entry.hours) }); setError("") }}><Pencil className="size-4" /></Button>}
        {canSubmit && (entry.status === "draft" || entry.status === "rejected") && <Button size="icon-sm" variant="outline" title="Submit entry" aria-label="Submit entry" disabled={busy} onClick={() => onSubmit ? onSubmit() : void perform(() => onStatusChange(entry.id, "submitted", undefined, entry.revision))}><Send className="size-4" /></Button>}
        {onRequestReview && <Button size="icon-sm" variant="outline" title="Request reviewer help" aria-label="Request reviewer help" disabled={busy} onClick={onRequestReview}><UserPlus className="size-4" /></Button>}
        {canSubmit && entry.status === "submitted" && <Button size="icon-sm" variant="outline" title="Recall entry to draft" aria-label="Recall entry to draft" disabled={busy} onClick={() => void perform(() => onStatusChange(entry.id, "draft", undefined, entry.revision))}><ClipboardList className="size-4" /></Button>}
        {canReview && entry.reviewEligible !== false && entry.status === "submitted" && <><Button size="icon-sm" variant="outline" title="Approve entry" aria-label="Approve entry" disabled={busy} onClick={() => onReview(entry, "approved")}><CheckCircle2 className="size-4" /></Button><Button size="icon-sm" variant="outline" title="Reject entry" aria-label="Reject entry" disabled={busy} onClick={() => onReview(entry, "rejected")}><XCircle className="size-4" /></Button></>}
        <Button size="icon-sm" variant="ghost" title="Delete entry" aria-label="Delete entry" disabled={!canDelete || busy} onClick={() => onDelete(entry.id)}><Trash2 className="size-4" /></Button>
      </div></td>
    </tr>
    {editing && <WindowSurface title="Edit time entry" disabled={busy} onBack={cancel}>
      <form noValidate onSubmit={event => { event.preventDefault(); void save() }} className="flex min-h-0 w-full flex-col bg-white">
        <h2 className="shrink-0 border-b px-4 py-3 text-base font-semibold">Edit time entry</h2>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">Contractor<input autoFocus aria-label="Contractor" className={inputClass + " mt-1"} value={draft.contractor} disabled={busy} onChange={event => setDraft({ ...draft, contractor: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Project<input aria-label="Project" className={inputClass + " mt-1"} value={draft.project} disabled={busy} onChange={event => setDraft({ ...draft, project: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Date<input type="date" aria-label="Date" className={inputClass + " mt-1"} value={draft.date} disabled={busy} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium">Hours<input type="number" step="any" min="0" aria-label="Hours" className={inputClass + " mt-1"} value={draft.hours} disabled={busy} onChange={event => setDraft({ ...draft, hours: event.target.value })} /></label>
            <label className="min-w-0 text-sm font-medium sm:col-span-2">Description<textarea aria-label="Description" className={inputClass + " mt-1 min-h-40 resize-y"} value={draft.description} disabled={busy} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
            {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          </div>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t bg-white px-4 py-3">
          <Button variant="outline" title="Cancel edit" aria-label="Cancel edit" disabled={busy} onClick={cancel}><X className="size-4" />Cancel</Button>
          <Button type="submit" title="Save entry" aria-label="Save entry" disabled={busy}><Save className="size-4" />{busy ? "Saving..." : "Save"}</Button>
        </footer>
      </form>
    </WindowSurface>}
  </Fragment>
}
