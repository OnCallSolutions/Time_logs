"use client"

/**
 * Provides the manager-facing report, approval filters, summaries, and CSV export.
 *
 * The report turns visible time entries into contractor totals, project counts,
 * approval status counts, date ranges, and exportable detail rows. It expects
 * authorization to have already happened upstream through the API response.
 */
import { useMemo, useState } from "react"
import { Download, Users, Clock, FolderKanban } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EntryStatus, TimeEntry } from "@/lib/types"

const statusOptions: { value: "all" | EntryStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

/**
 * Formats decimal hours for display without unnecessary trailing digits.
 *
 * Report totals can contain quarter-hour or decimal values, so formatting keeps
 * numbers compact while preserving meaningful fractions for billing review.
 *
 * @param n - Hour value to format.
 * @returns Localized hour string with up to two decimal places.
 */
function fmtHours(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Formats an ISO date string for report tables while preserving invalid input.
 *
 * The parser and database normally provide YYYY-MM-DD strings. If a value cannot
 * be parsed as a date, the original text is returned so the UI remains truthful
 * instead of hiding malformed data.
 *
 * @param iso - Date string formatted as YYYY-MM-DD.
 * @returns Localized date label, or the original value when invalid.
 */
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00")
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Builds a filterable manager report with summary stats and CSV export.
 *
 * The component derives all summaries from the currently filtered entry set. This
 * keeps the stat tiles, contractor bars, date range, detail table, and CSV export
 * aligned with the same filter state.
 *
 * @param props - Component props.
 * @param props.entries - Entries available to summarize and export.
 * @returns A filterable report view for manager-facing summaries.
 */
export function ManagerReport({ entries }: { entries: TimeEntry[] }) {
  const [contractor, setContractor] = useState("all")
  const [project, setProject] = useState("all")
  const [status, setStatus] = useState<"all" | EntryStatus>("approved")

  const contractors = useMemo(
    () => Array.from(new Set(entries.map((e) => e.contractor))).sort(),
    [entries],
  )
  const projects = useMemo(
    () => Array.from(new Set(entries.map((e) => e.project))).sort(),
    [entries],
  )

  const filtered = useMemo(
    () =>
      entries.filter(
          (e) =>
            (contractor === "all" || e.contractor === contractor) &&
            (project === "all" || e.project === project) &&
            (status === "all" || e.status === status),
      ),
    [entries, contractor, project, status],
  )

  const totalHours = filtered.reduce((s, e) => s + (Number(e.hours) || 0), 0)

  const byContractor = useMemo(() => {
    const map = new Map<
      string,
      { hours: number; projects: Set<string>; count: number }
    >()
    for (const e of filtered) {
      const cur = map.get(e.contractor) ?? {
        hours: 0,
        projects: new Set<string>(),
        count: 0,
      }
      cur.hours += Number(e.hours) || 0
      cur.projects.add(e.project)
      cur.count += 1
      map.set(e.contractor, cur)
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, projects: v.projects.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [filtered])

  const maxHours = Math.max(1, ...byContractor.map((c) => c.hours))

  const dateRange = useMemo(() => {
    const dates = filtered.map((e) => e.date).filter(Boolean).sort()
    if (dates.length === 0) return "—"
    return dates[0] === dates[dates.length - 1]
      ? fmtDate(dates[0])
      : `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`
  }, [filtered])

  /**
   * Downloads the currently filtered report rows as a CSV file.
   *
   * Values are quoted and embedded quotes are escaped so contractor names,
   * descriptions, or project labels containing commas remain valid CSV fields.
   *
   * @returns Nothing; triggers a browser download as a side effect.
   */
  function exportCsv() {
    const rows = [
      [
        "Contractor",
        "Date",
        "Project",
        "Description",
        "Status",
        "Review note",
        "Hours",
      ],
      ...filtered.map((e) => [
        e.contractor,
        e.date,
        e.project,
        e.description,
        e.status,
        e.reviewNote ?? "",
        String(e.hours),
      ]),
    ]
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "contractor-hours-report.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls =
    "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

  const stats = [
    { label: "Total hours", value: `${fmtHours(totalHours)}h`, icon: Clock },
    { label: "Contractors", value: String(byContractor.length), icon: Users },
    { label: "Projects", value: String(new Set(filtered.map((e) => e.project)).size), icon: FolderKanban },
  ]

  const statusCounts = statusOptions
    .filter((option) => option.value !== "all")
    .map((option) => ({
      label: option.label,
      count: entries.filter((entry) => entry.status === option.value).length,
    }))

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="f-contractor" className="text-xs text-muted-foreground">
              Contractor
            </label>
            <select
              id="f-contractor"
              className={selectCls}
              value={contractor}
              onChange={(e) => setContractor(e.target.value)}
            >
              <option value="all">All</option>
              {contractors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="f-project" className="text-xs text-muted-foreground">
              Project
            </label>
            <select
              id="f-project"
              className={selectCls}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="all">All</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="f-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select
              id="f-status"
              className={selectCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | EntryStatus)}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statusCounts.map(({ label, count }) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {count}
            </p>
          </div>
        ))}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
              {value}
            </p>
            {label === "Total hours" && (
              <p className="mt-1 text-xs text-muted-foreground">{dateRange}</p>
            )}
          </div>
        ))}
      </div>

      {/* Per-contractor summary */}
      <div className="border-y border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Hours by contractor</h3>
        <ul className="flex flex-col gap-3">
          {byContractor.map((c) => (
            <li key={c.name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono tabular-nums">
                  {fmtHours(c.hours)}h
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.projects} {c.projects === 1 ? "project" : "projects"} ·{" "}
                    {c.count} {c.count === 1 ? "entry" : "entries"}
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(c.hours / maxHours) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Detail table */}
      <div className="overflow-hidden border-y border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Detailed entries</h3>
          <p className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"} shown
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Contractor</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Review note</th>
                <th className="px-4 py-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice()
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-4 py-2 font-medium">{e.contractor}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {fmtDate(e.date)}
                    </td>
                    <td className="px-4 py-2">{e.project}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {e.description || "—"}
                    </td>
                    <td className="px-4 py-2 capitalize">{e.status}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {e.reviewNote || "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {fmtHours(Number(e.hours) || 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
