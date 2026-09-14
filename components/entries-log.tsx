"use client"

import { Trash2, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { TimeEntry } from "@/lib/types"

const inputCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30"

export function EntriesLog({
  entries,
  onUpdate,
  onDelete,
  onClear,
}: {
  entries: TimeEntry[]
  onUpdate: (id: string, patch: Partial<TimeEntry>) => void
  onDelete: (id: string) => void
  onClear: () => void
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
          <h2 className="text-sm font-semibold">Time entries</h2>
          <p className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · edit any
            cell to correct it
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onClear}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Clear all
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Contractor</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 text-right font-medium">Hours</th>
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="px-2 py-1.5">
                  <input
                    className={inputCls + " font-medium"}
                    value={entry.contractor}
                    aria-label="Contractor"
                    onChange={(e) =>
                      onUpdate(entry.id, { contractor: e.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="date"
                    className={inputCls + " font-mono text-xs"}
                    value={entry.date}
                    aria-label="Date"
                    onChange={(e) => onUpdate(entry.id, { date: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={inputCls}
                    value={entry.project}
                    aria-label="Project"
                    onChange={(e) =>
                      onUpdate(entry.id, { project: e.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={inputCls + " text-muted-foreground"}
                    value={entry.description}
                    aria-label="Description"
                    onChange={(e) =>
                      onUpdate(entry.id, { description: e.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    className={inputCls + " text-right font-mono tabular-nums"}
                    value={entry.hours}
                    aria-label="Hours"
                    onChange={(e) =>
                      onUpdate(entry.id, { hours: Number(e.target.value) })
                    }
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete entry"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40">
              <td
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                colSpan={4}
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
