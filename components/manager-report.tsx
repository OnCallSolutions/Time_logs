"use client"

/**
 * Provides the manager-facing report, approval filters, summaries, and CSV export.
 *
 * The report turns visible time entries into contractor totals, project counts,
 * approval status counts, date ranges, and exportable detail rows. It expects
 * authorization to have already happened upstream through the API response.
 */
import { useMemo } from "react"
import { Download, Users, Clock, FolderKanban, Search, FilterX, LayoutGrid, List, ChevronDown, SlidersHorizontal } from "lucide-react"
import { useRetainedViewState } from "@/components/use-retained-view-state"
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
export function ManagerReport({ entries, stateKey }: { entries: TimeEntry[]; stateKey?: string }) {
  const [query, setQuery] = useRetainedViewState(stateKey?`${stateKey}:query`:undefined,"")
  const [contractor, setContractor] = useRetainedViewState(stateKey?`${stateKey}:contractor`:undefined,`all`)
  const [project, setProject] = useRetainedViewState(stateKey?`${stateKey}:project`:undefined,`all`)
  const [status, setStatus] = useRetainedViewState<"all" | EntryStatus>(stateKey?`${stateKey}:status`:undefined,`all`)
  const [dateFrom,setDateFrom]=useRetainedViewState(stateKey?`${stateKey}:from`:undefined,"")
  const [dateThrough,setDateThrough]=useRetainedViewState(stateKey?`${stateKey}:through`:undefined,"")
  const [viewBy, setViewBy] = useRetainedViewState<"summary" | "entries">(stateKey?`${stateKey}:view`:undefined,`summary`)
  const [groupBy, setGroupBy] = useRetainedViewState<"contractor" | "project" | "date" | "month" | "status">(stateKey?`${stateKey}:group`:undefined,`contractor`)
  const [sortBy, setSortBy] = useRetainedViewState(stateKey?`${stateKey}:sort`:undefined,`hours_desc`)

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
            (status === "all" || e.status === status) &&
            (!dateFrom||e.date>=dateFrom) && (!dateThrough||e.date<=dateThrough) &&
            (!query.trim() || [e.contractor,e.project,e.description,e.reviewNote,e.date,e.status].some(value=>value?.toLowerCase().includes(query.trim().toLowerCase()))),
      ),
    [entries, contractor, project, status, dateFrom, dateThrough, query],
  )

  const totalHours = filtered.reduce((s, e) => s + (Number(e.hours) || 0), 0)

  const groupLabel = (entry: TimeEntry) =>
    groupBy === "contractor"
      ? entry.contractor
      : groupBy === "project"
        ? entry.project
        : groupBy === "date"
          ? entry.date
          : groupBy === "month"
            ? entry.date.slice(0,7)
            : entry.status
  const groupTitle = groupBy === "date" ? "day" : groupBy === "month" ? "month" : groupBy
  const byGroup = useMemo(() => {
    const map = new Map<string, { hours: number; projects: Set<string>; contractors: Set<string>; count: number; firstDate: string; lastDate: string }>()
    for (const e of filtered) {
      const key = groupLabel(e)
      const cur = map.get(key) ?? {
        hours: 0,
        projects: new Set<string>(),
        contractors: new Set<string>(),
        count: 0,
        firstDate: e.date,
        lastDate: e.date,
      }
      cur.hours += Number(e.hours) || 0
      cur.projects.add(e.project)
      cur.contractors.add(e.contractor)
      cur.count += 1
      if (e.date < cur.firstDate) cur.firstDate = e.date
      if (e.date > cur.lastDate) cur.lastDate = e.date
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, projects: v.projects.size, contractors: v.contractors.size }))
      .sort((a, b) => {
        if (sortBy === "hours_asc") return a.hours - b.hours
        if (sortBy === "name_asc") return a.name.localeCompare(b.name)
        if (sortBy === "newest") return b.lastDate.localeCompare(a.lastDate)
        if (sortBy === "oldest") return a.firstDate.localeCompare(b.firstDate)
        return b.hours - a.hours
      })
  }, [filtered, groupBy, sortBy])

  const maxHours = Math.max(1, ...byGroup.map((group) => group.hours))

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
    { label: "Hours", value: `${fmtHours(totalHours)}h`, icon: Clock,color:"text-orange-700",surface:"bg-orange-50 border-orange-200" },
    { label: "People", value: String(new Set(filtered.map((e) => e.contractor)).size), icon: Users,color:"text-blue-700",surface:"bg-blue-50 border-blue-200" },
    { label: "Projects", value: String(new Set(filtered.map((e) => e.project)).size), icon: FolderKanban,color:"text-emerald-700",surface:"bg-emerald-50 border-emerald-200" },
  ]

  const statusCounts = statusOptions
    .filter((option) => option.value !== "all")
    .map((option) => ({
      label: option.label,
      count: filtered.filter((entry) => entry.status === option.value).length,
    }))

  const sortedDetails = filtered.slice().sort((a, b) => {
    if (sortBy === "hours_desc") return Number(b.hours) - Number(a.hours)
    if (sortBy === "hours_asc") return Number(a.hours) - Number(b.hours)
    if (sortBy === "name_asc") return a.contractor.localeCompare(b.contractor)
    return sortBy === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
  })
  const detailGroups = Array.from(
    sortedDetails.reduce((groups, entry) => {
      const key = groupLabel(entry)
      const rows = groups.get(key) ?? []
      rows.push(entry)
      groups.set(key, rows)
      return groups
    }, new Map<string, TimeEntry[]>()).entries(),
  )
  const groupLabelForDisplay = (label: string) =>
    groupBy === "date" ? fmtDate(label) : groupBy === "month" ? new Date(`${label}-01T00:00:00`).toLocaleDateString(undefined,{month:"long",year:"numeric"}) : groupBy === "status" ? label[0]?.toUpperCase() + label.slice(1) : label
  const hasFilters = query.trim() !== "" || contractor !== "all" || project !== "all" || status !== "all" || dateFrom!=="" || dateThrough!==""
  const resetFilters = () => {
    setQuery("")
    setContractor("all")
    setProject("all")
    setStatus("all")
    setDateFrom("")
    setDateThrough("")
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 text-slate-800">
      <section className="rounded-md border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-orange-50 p-2.5" aria-label="Report controls">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1" htmlFor="report-search">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-sky-700" aria-hidden="true" />
            <input id="report-search" className={`${selectCls} w-full pl-8`} placeholder="Search names, projects, notes…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="sr-only" htmlFor="report-contractor">Contractor</label>
          <select id="report-contractor" aria-label="Contractor filter" className={`${selectCls} max-w-48`} value={contractor} onChange={(event) => setContractor(event.target.value)}>
            <option value="all">All contractors</option>
            {contractors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <label className="sr-only" htmlFor="report-project">Project</label>
          <select id="report-project" aria-label="Project filter" className={`${selectCls} max-w-48`} value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="all">All projects</option>
            {projects.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <label className="sr-only" htmlFor="report-status">Status</label>
          <select id="report-status" aria-label="Status filter" className={selectCls} value={status} onChange={(event) => setStatus(event.target.value as "all" | EntryStatus)}>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label} status</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600" htmlFor="report-date-from">From<input id="report-date-from" aria-label="From date" type="date" value={dateFrom} max={dateThrough||undefined} onChange={event=>setDateFrom(event.target.value)} className={selectCls}/></label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600" htmlFor="report-date-through">Through<input id="report-date-through" aria-label="Through date" type="date" value={dateThrough} min={dateFrom||undefined} onChange={event=>setDateThrough(event.target.value)} className={selectCls}/></label>
          <Button variant="outline" size="icon-sm" title="Clear filters" aria-label="Clear filters" disabled={!hasFilters} onClick={resetFilters} className="border-slate-300 bg-white"><FilterX className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100">
            <Download className="size-3.5" aria-hidden="true" /> Export
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">View by</span>
            <div className="inline-flex rounded-md border border-sky-200 bg-white p-0.5" role="group" aria-label="Report view">
              <button type="button" aria-pressed={viewBy === "summary"} onClick={() => setViewBy("summary")} className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${viewBy === "summary" ? "bg-sky-700 text-white" : "text-slate-700 hover:bg-sky-50"}`}><LayoutGrid className="size-3.5" /> Summary</button>
              <button type="button" aria-pressed={viewBy === "entries"} onClick={() => setViewBy("entries")} className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${viewBy === "entries" ? "bg-orange-600 text-white" : "text-slate-700 hover:bg-orange-50"}`}><List className="size-3.5" /> Entries</button>
            </div>
            <details className="group relative z-20 ml-1">
              <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-sky-200 bg-white px-2 text-xs font-medium text-sky-950 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="mr-1.5 size-3.5"/>Group and sort<ChevronDown className="ml-2 size-3.5 transition-transform group-open:rotate-180"/></summary>
              <div className="absolute left-0 z-50 mt-1 flex min-w-56 flex-wrap items-end gap-2 rounded-md border border-sky-200 bg-white p-3 shadow-lg">
            <label className="flex items-center gap-1.5 text-xs text-slate-600" htmlFor="report-group">Group
              <select id="report-group" aria-label="Group by" className={selectCls} value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
                <option value="contractor">Contractor</option><option value="project">Project</option><option value="date">Date</option><option value="month">Month</option><option value="status">Status</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600" htmlFor="report-sort">Sort
              <select id="report-sort" aria-label="Sort by" className={selectCls} value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="hours_desc">Hours: high to low</option><option value="hours_asc">Hours: low to high</option><option value="name_asc">Name: A to Z</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
              </select>
            </label>
              </div>
            </details>
          </div>
          <p className="text-xs tabular-nums text-slate-600">{filtered.length} {filtered.length === 1 ? "entry" : "entries"} · {dateRange}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2" aria-label="Report totals">
        {stats.map(({ label, value, icon: Icon, color, surface }) => (
          <div key={label} className={`inline-flex min-w-32 items-center gap-2 rounded-md border px-3 py-1.5 ${surface}`}>
            <Icon className={`size-4 ${color}`} aria-hidden="true" />
            <span className="text-xs font-medium text-slate-600">{label}</span>
            <strong className="ml-auto font-mono text-sm tabular-nums text-slate-900">{value}</strong>
          </div>
        ))}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {statusCounts.map(({ label, count }) => <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{label} <b className="ml-1 text-slate-900">{count}</b></span>)}
        </div>
      </div>

      {viewBy === "summary" ? (
        <section className="min-h-0 overflow-auto rounded-md border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-sky-50/70 p-3" aria-label={`Hours by ${groupTitle}`}>
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-emerald-100 pb-2">
            <h3 className="text-sm font-semibold text-emerald-950">Hours by {groupTitle}</h3>
            <span className="text-xs text-slate-500">{byGroup.length} {byGroup.length === 1 ? "group" : "groups"}</span>
          </div>
          {byGroup.length ? <ul className="divide-y divide-emerald-100">
            {byGroup.map((group) => <li key={group.name} className="grid grid-cols-[minmax(7rem,1fr)_minmax(5rem,2fr)_auto] items-center gap-3 py-2">
              <span className="truncate text-sm font-medium" title={groupLabelForDisplay(group.name)}>{groupLabelForDisplay(group.name)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/90 ring-1 ring-emerald-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width]" style={{ width: `${(group.hours / maxHours) * 100}%` }} /></div>
              <span className="whitespace-nowrap text-right font-mono text-xs tabular-nums">{fmtHours(group.hours)}h <span className="text-slate-500">· {group.count} {group.count === 1 ? "entry" : "entries"}</span></span>
            </li>)}
          </ul> : <p className="py-8 text-center text-sm text-slate-500">No entries match these filters.</p>}
        </section>
      ) : (
        <section className="min-h-0 overflow-hidden rounded-md border border-orange-200 bg-white" aria-label="Detailed report entries">
          <div className="max-h-[min(62vh,48rem)] overflow-auto">
            <table className="w-full min-w-[54rem] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-orange-100 text-[11px] uppercase text-orange-950 shadow-sm">
                <tr><th className="px-2.5 py-2 font-semibold">Contractor</th><th className="px-2.5 py-2 font-semibold">Date</th><th className="px-2.5 py-2 font-semibold">Project</th><th className="px-2.5 py-2 font-semibold">Description</th><th className="px-2.5 py-2 font-semibold">Status</th><th className="px-2.5 py-2 font-semibold">Review note</th><th className="px-2.5 py-2 text-right font-semibold">Hours</th></tr>
              </thead>
              {detailGroups.map(([groupName, rows]) => <tbody key={groupName}>
                <tr className="bg-sky-50 text-sky-950"><th colSpan={7} className="border-y border-sky-100 px-2.5 py-1.5 text-left font-semibold">{groupLabelForDisplay(groupName)} <span className="ml-2 font-normal text-sky-800">{rows.length} {rows.length === 1 ? "entry" : "entries"} · {fmtHours(rows.reduce((sum, row) => sum + Number(row.hours || 0), 0))}h</span></th></tr>
                {rows.map((entry, index) => <tr key={entry.id} className={`${index % 2 ? "bg-slate-50/70" : "bg-white"} border-b border-slate-100 last:border-0`}>
                  <td className="max-w-40 truncate px-2.5 py-1.5 font-medium" title={entry.contractor}>{entry.contractor}</td><td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-slate-600">{fmtDate(entry.date)}</td><td className="max-w-36 truncate px-2.5 py-1.5" title={entry.project}>{entry.project}</td><td className="max-w-64 truncate px-2.5 py-1.5 text-slate-600" title={entry.description}>{entry.description || "—"}</td><td className="px-2.5 py-1.5"><span className={`rounded-full px-1.5 py-0.5 capitalize ${entry.status === "approved" ? "bg-emerald-100 text-emerald-800" : entry.status === "rejected" ? "bg-red-100 text-red-800" : entry.status === "submitted" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>{entry.status}</span></td><td className="max-w-48 truncate px-2.5 py-1.5 text-slate-600" title={entry.reviewNote ?? ""}>{entry.reviewNote || "—"}</td><td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{fmtHours(Number(entry.hours) || 0)}</td>
                </tr>)}
              </tbody>)}
              {!detailGroups.length && <tbody><tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">No entries match these filters.</td></tr></tbody>}
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
