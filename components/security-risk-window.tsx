/**
 * Displays periodic security monitoring reports in a white admin-only dialog.
 * Opening the window reads stored reports without launching an AI analysis.
 * Report timestamps, failures, and coverage limits remain visible for review.
 */
"use client"
import { useEffect, useState } from "react"
import { RefreshCw, ShieldCheck, AlertTriangle, Search, ChevronDown, SlidersHorizontal } from "lucide-react"
import { apiPath } from "@/lib/paths"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import { DataExportMenu } from "@/components/data-export-menu"

type Report = { run_day: string; status: string; event_count: number; possibly_truncated: boolean;
  completed_at: string | null; assessment: { severity: string; summary: string;
    findings: { eventIds: string[]; explanation: string; recommendation: string }[] } | null }

/**
 * Loads recent reports and renders status, severity, evidence, and recommendations.
 * @param props - Dialog properties.
 * @param props.onClose - Callback that dismisses the risk summary window.
 * @returns JSX.Element containing the risk summary dialog.
 */
export function SecurityRiskWindow({ onClose }: { onClose: () => void }) {
  const [refresh, setRefresh] = useState(0)
  const [severity, setSeverity] = useState("all")
  const [search,setSearch]=useState("")
  const [dateFrom,setDateFrom]=useState("")
  const [dateThrough,setDateThrough]=useState("")
  const [groupBy,setGroupBy]=useState<"day"|"month"|"year"|"period">("day")
  const [sortOrder,setSortOrder]=useState<"newest"|"oldest">("newest")
  const [periods,setPeriods]=useState<{id:string;name:string;startDate:string;endDate:string}[]>([])
  const [finding,setFinding]=useState<{eventIds:string[];explanation:string;recommendation:string}|null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    fetch(apiPath("/api/security"), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setReports(data.reports)
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  useEffect(()=>{let active=true;void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store"}).then(async response=>response.ok?response.json():null).then(data=>{if(active&&Array.isArray(data?.periods))setPeriods(data.periods)}).catch(()=>{});return()=>{active=false}},[])
  const visibleReports = reports.filter(report => {
    const day=String(report.run_day).slice(0,10),text=[report.run_day,report.status,report.assessment?.severity,report.assessment?.summary,...(report.assessment?.findings??[]).flatMap(item=>[item.explanation,item.recommendation])].join(" ").toLowerCase()
    return (severity === "all" || report.assessment?.severity.toLowerCase() === severity)&&(!dateFrom||day>=dateFrom)&&(!dateThrough||day<=dateThrough)&&(!search.trim()||text.includes(search.trim().toLowerCase()))
  })
  const orderedReports=visibleReports.slice().sort((a,b)=>sortOrder==="newest"?String(b.run_day).localeCompare(String(a.run_day)):String(a.run_day).localeCompare(String(b.run_day)))
  const groupedReports=Array.from(orderedReports.reduce((groups,report)=>{
    const day=String(report.run_day).slice(0,10),period=periods.find(item=>day>=item.startDate&&day<=item.endDate)
    const key=groupBy==="day"?day:groupBy==="month"?day.slice(0,7):groupBy==="year"?day.slice(0,4):period?.id??"unassigned"
    const label=groupBy==="day"?new Date(`${day}T00:00:00Z`).toLocaleDateString():groupBy==="month"?new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined,{month:"long",year:"numeric"}):groupBy==="year"?key:period?.name??"Outside configured timesheet periods"
    const group=groups.get(key)??{label,reports:[] as Report[]};group.reports.push(report);groups.set(key,group);return groups
  },new Map<string,{label:string;reports:Report[]}>()).entries())
  const latest = reports[0]
  return <WindowSurface title="Security risks" onBack={onClose}>
    <section className="tech-surface flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-white text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-full bg-red-100 text-red-700"><ShieldCheck className="size-5" /></span><div><h2 className="text-lg font-semibold text-red-950">Security risks</h2><p className="text-xs text-red-800">AI monitoring and reviewed findings</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">Severity <select value={severity} onChange={event => setSeverity(event.target.value)} className="rounded-md border border-input bg-white px-2 py-2"><option value="all">All severities</option>{["critical","high","medium","low"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="relative min-w-44 flex-1 text-xs font-medium">Search<input aria-label="Search security reports" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Summary, finding, recommendation…" className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white py-1 pl-8 pr-2 text-sm"/><Search className="absolute left-2 top-7 size-4 text-slate-500"/></label>
          <details className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-950 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="mr-1.5 size-3.5"/>View options<ChevronDown className="ml-2 size-3.5 transition-transform group-open:rotate-180"/></summary>
            <div className="absolute right-0 z-10 mt-1 flex flex-wrap items-end gap-2 rounded-md border border-red-200 bg-white p-3 shadow-lg">
              <label className="text-xs">From<input aria-label="Security report date from" type="date" value={dateFrom} max={dateThrough||undefined} onChange={event=>setDateFrom(event.target.value)} className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"/></label>
              <label className="text-xs">Through<input aria-label="Security report date through" type="date" value={dateThrough} min={dateFrom||undefined} onChange={event=>setDateThrough(event.target.value)} className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"/></label>
              <label className="text-xs">Group by<select aria-label="Group security reports by" value={groupBy} onChange={event=>setGroupBy(event.target.value as typeof groupBy)} className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option><option value="period">Timesheet period</option></select></label>
              <label className="text-xs">Sort<select aria-label="Sort security reports" value={sortOrder} onChange={event=>setSortOrder(event.target.value as typeof sortOrder)} className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
          </details>
          <DataExportMenu title="Security risk report" filename="security-risk-report" rows={orderedReports.map(report=>({date:String(report.run_day).slice(0,10),status:report.status,severity:report.assessment?.severity??"unavailable",eventsReviewed:report.event_count,coverageTruncated:report.possibly_truncated,summary:report.assessment?.summary??"",findings:(report.assessment?.findings??[]).map((item,index)=>`${index+1}. ${item.explanation} Recommendation: ${item.recommendation} Evidence: ${item.eventIds.join(", ")}`).join(" | ")}))} summary={{reports:orderedReports.length,severity,from:dateFrom||"Any",through:dateThrough||"Any",search:search||"None",sort:sortOrder}}/>
          <Button variant="outline" size="icon-sm" aria-label="Refresh security reports" title="Refresh security reports" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 md:p-6">
      {!loading && !error && latest && <div className="mb-4 grid gap-3 border-b border-slate-200 pb-4 sm:grid-cols-3">
        <div className="rounded-md border border-red-200 bg-red-50 p-3"><p className="text-xs text-red-800">Latest assessment</p><p className="font-semibold text-red-950">{latest.assessment?.severity.toUpperCase() ?? latest.status}</p></div>
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-800">Events reviewed</p><p className="font-semibold text-blue-950">{latest.event_count}</p></div>
        <div className="rounded-md border border-green-200 bg-green-50 p-3"><p className="text-xs text-green-800">Completed</p><p className="text-sm font-medium text-green-950">{latest.completed_at ? new Date(latest.completed_at).toLocaleString() : "Pending"}</p></div>
      </div>}
      {loading && <p role="status">Loading reports...</p>}
      {error && <div role="alert" className="flex items-center gap-2 border-l-2 border-destructive bg-red-50 p-3 text-red-700"><AlertTriangle className="size-4" />{error}</div>}
      {!loading && !error && !reports.length && <p>No monitoring reports yet.</p>}
      {!loading && !error && reports.length > 0 && !visibleReports.length && <p className="text-sm text-muted-foreground">No reports match this severity.</p>}
      {groupedReports.map(([groupKey,group])=><section key={groupKey} className="mb-4"><h3 className="sticky top-0 z-[1] border-y border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">{group.label} <span className="font-normal text-sky-800">{group.reports.length} reports</span></h3>{group.reports.map(report => <article key={report.run_day} className="mb-3 border-l-4 border-orange-400 bg-orange-50/50 px-4 py-4">
        <h3 className="font-semibold text-orange-950">{String(report.run_day).slice(0,10)} - {report.assessment?.severity.toUpperCase() ?? report.status}</h3>
        <p className="text-sm text-gray-600">{report.event_count} recorded events; past 24 hours. {report.possibly_truncated ? "Coverage may be truncated at 250 events." : ""}</p>
        <p className="text-sm">Completed: {report.completed_at ? new Date(report.completed_at).toLocaleString() : "Pending"}</p>
        {report.status === "failed" && <p className="text-red-700">Monitoring failed. Review service configuration.</p>}
        <p>{report.assessment?.summary}</p>
        {report.assessment?.findings.map((item,index) => <button type="button" key={index} className="mt-3 block w-full border-l-2 border-blue-500 bg-blue-50 px-3 py-2 text-left text-sm font-medium text-blue-950 hover:bg-blue-100" onClick={()=>setFinding(item)}>Finding {index + 1}: {item.explanation}</button>)}
      </article>)}</section>)}
      </div>
    </section>
    {finding&&<WindowSurface title="Security finding" onBack={()=>setFinding(null)}><section className="h-full w-full overflow-auto bg-white p-4 sm:p-6"><h2 className="font-semibold">Security finding</h2><p className="mt-3 text-sm">{finding.explanation}</p><h3 className="mt-4 text-sm font-semibold">Recommendation</h3><p className="mt-2 text-sm">{finding.recommendation}</p><p className="mt-4 break-all text-xs text-muted-foreground">Evidence: {finding.eventIds.join(", ")||"No linked events"}</p></section></WindowSurface>}
  </WindowSurface>
}
