/**
 * Displays periodic security monitoring reports in a white admin-only dialog.
 * Opening the window reads stored reports without launching an AI analysis.
 * Report timestamps, failures, and coverage limits remain visible for review.
 */
"use client"
import { useEffect, useState } from "react"
import { RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react"
import { apiPath } from "@/lib/paths"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"

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
  const visibleReports = reports.filter(report => severity === "all" || report.assessment?.severity.toLowerCase() === severity)
  const latest = reports[0]
  return <WindowSurface title="Security risks" onBack={onClose}>
    <section className="tech-surface flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-white text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-full bg-red-100 text-red-700"><ShieldCheck className="size-5" /></span><div><h2 className="text-lg font-semibold text-red-950">Security risks</h2><p className="text-xs text-red-800">AI monitoring and reviewed findings</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">Severity <select value={severity} onChange={event => setSeverity(event.target.value)} className="rounded-md border border-input bg-white px-2 py-2"><option value="all">All severities</option>{["critical","high","medium","low"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
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
      {visibleReports.map(report => <article key={report.run_day} className="mb-3 border-l-4 border-orange-400 bg-orange-50/50 px-4 py-4">
        <h3 className="font-semibold text-orange-950">{String(report.run_day).slice(0,10)} - {report.assessment?.severity.toUpperCase() ?? report.status}</h3>
        <p className="text-sm text-gray-600">{report.event_count} recorded events; past 24 hours. {report.possibly_truncated ? "Coverage may be truncated at 250 events." : ""}</p>
        <p className="text-sm">Completed: {report.completed_at ? new Date(report.completed_at).toLocaleString() : "Pending"}</p>
        {report.status === "failed" && <p className="text-red-700">Monitoring failed. Review service configuration.</p>}
        <p>{report.assessment?.summary}</p>
        {report.assessment?.findings.map((item,index) => <button type="button" key={index} className="mt-3 block w-full border-l-2 border-blue-500 bg-blue-50 px-3 py-2 text-left text-sm font-medium text-blue-950 hover:bg-blue-100" onClick={()=>setFinding(item)}>Finding {index + 1}: {item.explanation}</button>)}
      </article>)}
      </div>
    </section>
    {finding&&<WindowSurface title="Security finding" onBack={()=>setFinding(null)}><section className="h-full w-full overflow-auto bg-white p-4 sm:p-6"><h2 className="font-semibold">Security finding</h2><p className="mt-3 text-sm">{finding.explanation}</p><h3 className="mt-4 text-sm font-semibold">Recommendation</h3><p className="mt-2 text-sm">{finding.recommendation}</p><p className="mt-4 break-all text-xs text-muted-foreground">Evidence: {finding.eventIds.join(", ")||"No linked events"}</p></section></WindowSurface>}
  </WindowSurface>
}
