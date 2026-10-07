/**
 * Displays periodic security monitoring reports in a white admin-only dialog.
 * Opening the window reads stored reports without launching an AI analysis.
 * Report timestamps, failures, and coverage limits remain visible for review.
 */
"use client"
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { apiPath } from "@/lib/paths"
import { useDialogFocus } from "@/components/use-dialog-focus"

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
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    fetch(apiPath("/api/security"), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setReports(data.reports)
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[60] bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Security risks">
    <section className="mx-auto max-h-[90svh] max-w-5xl overflow-auto rounded-lg bg-white p-6 text-black">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Security risks</h2>
        <button autoFocus onClick={onClose} title="Close security risks" aria-label="Close security risks"><X /></button></div>
      {loading && <p role="status">Loading reports...</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!loading && !error && !reports.length && <p>No monitoring reports yet.</p>}
      {reports.map(report => <article key={report.run_day} className="border-b py-4">
        <h3 className="font-semibold">{String(report.run_day).slice(0,10)} - {report.assessment?.severity.toUpperCase() ?? report.status}</h3>
        <p className="text-sm text-gray-600">{report.event_count} recorded events; past 24 hours. {report.possibly_truncated ? "Coverage may be truncated at 250 events." : ""}</p>
        <p className="text-sm">Completed: {report.completed_at ? new Date(report.completed_at).toLocaleString() : "Pending"}</p>
        {report.status === "failed" && <p className="text-red-700">Monitoring failed. Review service configuration.</p>}
        <p>{report.assessment?.summary}</p>
        {report.assessment?.findings.map((finding,index) => <div key={index} className="mt-3 border-l-2 border-blue-600 pl-3">
          <p>{finding.explanation}</p><p>{finding.recommendation}</p><p className="break-all text-xs">Evidence: {finding.eventIds.join(", ")}</p>
        </div>)}
      </article>)}
    </section>
  </div>
}
