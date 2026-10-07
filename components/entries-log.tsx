"use client"

/**
 * Provides the editable entries table used for personal, team, and approval logs.
 *
 * This component is shared by regular users, managers, and administrators. Its
 * props control whether the table describes personal or team data, whether status
 * workflow controls are available, and whether elevated bulk clearing controls
 * should be available.
 */
import {
  CheckCircle2,
  ClipboardList,
  Send,
  Trash2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EntryStatus, TimeEntry } from "@/lib/types"

const inputCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30"

const statusStyles: Record<EntryStatus, string> = {
  draft: "border-muted-foreground/20 bg-muted text-muted-foreground",
  submitted: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  approved: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
}

/**
 * Formats an entry status into a compact human-readable label.
 *
 * Status values are stored as lower-case machine values in the database. The UI
 * uses this helper wherever a visible status label is needed.
 *
 * @param status - Entry approval status to display.
 * @returns Title-cased status label.
 */
function statusLabel(status: EntryStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Renders a consistent badge for entry approval status.
 *
 * The badge is intentionally small so it works inside dense tables while still
 * making approval state scannable for managers.
 *
 * @param props - Badge props.
 * @param props.status - Entry approval status.
 * @returns A styled status badge.
 */
function StatusBadge({ status }: { status: EntryStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      {statusLabel(status)}
    </span>
  )
}

/**
 * Renders editable time entries with role-aware clearing controls.
 *
 * Each row is edited inline and delegates persistence to callbacks supplied by
 * the parent workspace. The component intentionally does not know whether entries
 * are personal or team-wide; it only renders the data and controls it receives.
 *
 * @param props - Entries table props and row action callbacks.
 * @param props.canClear - Whether to show the bulk clear button.
 * @param props.canReview - Whether to show manager approval controls.
 * @param props.canSubmit - Whether to show employee submission controls.
 * @param props.description - Supporting text shown under the table title.
 * @param props.entries - Entries to display and edit.
 * @param props.onUpdate - Callback invoked when an entry field changes.
 * @param props.onStatusChange - Callback invoked when approval status changes.
 * @param props.onDelete - Callback invoked when an entry is deleted.
 * @param props.onClear - Callback invoked when visible entries are cleared.
 * @param props.title - Heading displayed above the table.
 * @returns An editable entries table or empty-state panel.
 */
export function EntriesLog({
  canClear = false,
  canReview = false,
  canSubmit = false,
  description = "Edit any cell to correct it.",
  entries,
  onUpdate,
  onStatusChange,
  onDelete,
  onClear,
  title = "Time entries",
}: {
  canClear?: boolean
  canReview?: boolean
  canSubmit?: boolean
  description?: string
  entries: TimeEntry[]
  onUpdate: (id: string, patch: Partial<TimeEntry>) => void
  onStatusChange: (
    id: string,
    status: EntryStatus,
    reviewNote?: string,
  ) => void
  onDelete: (id: string) => void
  onClear: () => void
  title?: string
}) {
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

  const total = entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Contractor</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Hours</th>
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const canEditEntry =
                canReview ||
                entry.status === "draft" ||
                entry.status === "rejected"
              const canDeleteEntry = canEditEntry

              return (
                <tr
                  key={entry.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-2 py-1.5">
                    <input
                      className={inputCls + " font-medium disabled:opacity-60"}
                      value={entry.contractor}
                      aria-label="Contractor"
                      disabled={!canEditEntry}
                      onChange={(e) =>
                        onUpdate(entry.id, { contractor: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="date"
                      className={inputCls + " font-mono text-xs disabled:opacity-60"}
                      value={entry.date}
                      aria-label="Date"
                      disabled={!canEditEntry}
                      onChange={(e) =>
                        onUpdate(entry.id, { date: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={inputCls + " disabled:opacity-60"}
                      value={entry.project}
                      aria-label="Project"
                      disabled={!canEditEntry}
                      onChange={(e) =>
                        onUpdate(entry.id, { project: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={
                        inputCls + " text-muted-foreground disabled:opacity-60"
                      }
                      value={entry.description}
                      aria-label="Description"
                      disabled={!canEditEntry}
                      onChange={(e) =>
                        onUpdate(entry.id, { description: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-4 py-1.5">
                    <StatusBadge status={entry.status} />
                    {entry.reviewedBy && (
                      <p className="mt-1 max-w-36 truncate text-[0.65rem] text-muted-foreground">
                        by {entry.reviewedBy}
                      </p>
                    )}
                    {entry.reviewNote && (
                      <p className="mt-1 max-w-44 text-[0.65rem] text-destructive">
                        {entry.reviewNote}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      className={
                        inputCls +
                        " text-right font-mono tabular-nums disabled:opacity-60"
                      }
                      value={entry.hours}
                      aria-label="Hours"
                      disabled={!canEditEntry}
                      onChange={(e) =>
                        onUpdate(entry.id, { hours: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      {canSubmit &&
                        (entry.status === "draft" ||
                          entry.status === "rejected") && (
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Submit entry"
                            title="Submit entry"
                            onClick={() =>
                              onStatusChange(entry.id, "submitted")
                            }
                          >
                            <Send className="size-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      {canSubmit && entry.status === "submitted" && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Recall entry to draft"
                          title="Recall entry to draft"
                          onClick={() => onStatusChange(entry.id, "draft")}
                        >
                          <ClipboardList className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                      {canReview && entry.status === "submitted" && (
                        <>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Approve entry"
                            title="Approve entry"
                            onClick={() => onStatusChange(entry.id, "approved")}
                          >
                            <CheckCircle2
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Reject entry"
                            title="Reject entry"
                            onClick={() => {
                              const note = window.prompt("Reason for rejection")
                              if (note?.trim()) {
                                onStatusChange(entry.id, "rejected", note)
                              }
                            }}
                          >
                            <XCircle className="size-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete entry"
                        title={
                          canDeleteEntry
                            ? "Delete entry"
                            : "Submitted and approved entries are locked"
                        }
                        disabled={!canDeleteEntry}
                        onClick={() => onDelete(entry.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40">
              <td
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                colSpan={5}
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
  )
}
