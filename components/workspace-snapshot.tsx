/**
 * Shows a compact, full-width operational landing summary from authorized records.
 * Personal and review-lane totals stay distinct; no extra directory data is fetched.
 * Status colors and project totals expose work needing attention without noisy menus.
 */
"use client"
import { AlertCircle, CheckCircle2, ClipboardList, Send } from "lucide-react"
import type { TimeEntry, UserRole } from "@/lib/types"

/**
 * Summarizes loaded evidence without inferring manager/team assignment relationships.
 * @param props.entries - Server-authorized records already loaded by the shell.
 * @param props.email - Signed-in owner identity for personal totals.
 * @param props.role - Effective role determining personal versus review scope.
 * @param props.loading - Whether entry loading is incomplete.
 * @param props.canReview - Whether to show authorized submitted review-lane totals.
 * @returns JSX.Element with status totals, project coverage, and review context.
 */
export function WorkspaceSnapshot({ entries, email, role, loading, canReview }: {
  entries: TimeEntry[]; email: string; role: UserRole; loading: boolean; canReview: boolean;
}) {
  const personal = role === "contractor" || role === "employee" || role === "manager"
  const scope = personal ? entries.filter(entry => entry.ownerEmail?.toLowerCase() === email.toLowerCase()) : entries
  const metrics = [
    { status: "draft", label: "Drafts", icon: ClipboardList, color: "text-orange-800", background: "bg-orange-50" },
    { status: "submitted", label: "In review", icon: Send, color: "text-blue-800", background: "bg-blue-50" },
    { status: "rejected", label: "Needs correction", icon: AlertCircle, color: "text-red-800", background: "bg-red-50" },
    { status: "approved", label: "Approved", icon: CheckCircle2, color: "text-green-800", background: "bg-green-50" },
  ] as const
  const review = entries.filter(entry => entry.status === "submitted" && entry.reviewEligible !== false && entry.ownerEmail?.toLowerCase() !== email.toLowerCase())
  const projects = new Map<string, number>()
  for (const entry of scope) projects.set(entry.project, (projects.get(entry.project) ?? 0) + entry.hours)
  const topProjects = [...projects].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return <section aria-label="Workspace snapshot" className="grid gap-2 border-y border-sky-200 bg-gradient-to-r from-sky-50/80 via-white to-orange-50/70 py-2 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
    <div className="min-w-0"><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold text-slate-700">{personal ? "My work" : "Authorized work"}</h2><span className="text-[11px] text-muted-foreground">{loading ? "Loading..." : `${scope.length} entries / ${projects.size} projects`}</span></div>
      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{metrics.map(({ status, label, icon: Icon, color, background }) => {
        const rows = scope.filter(entry => entry.status === status)
        return <div key={status} className={`${background} flex min-w-0 items-center gap-2 rounded-md border border-white/80 px-2.5 py-1.5`}><Icon className={`size-4 shrink-0 ${color}`} aria-hidden="true"/><div className="min-w-0 flex-1"><dt className={`truncate text-[11px] font-medium ${color}`}>{label}</dt><dd className="text-[11px] text-muted-foreground">{rows.reduce((sum, entry) => sum + entry.hours, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}h</dd></div><dd className={`font-mono text-lg font-semibold tabular-nums ${color}`}>{loading ? "..." : rows.length}</dd></div>
      })}</dl>
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-sky-100 pt-2 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0"><div className="min-w-0 flex-1"><h2 className="text-[11px] font-semibold text-slate-700">{canReview ? "Review workload" : "Project activity"}</h2>
      {canReview && <p className="text-xs"><strong className="text-blue-800">{review.length}</strong> awaiting your review / {review.reduce((sum, entry) => sum + entry.hours, 0).toLocaleString()}h</p>}
      {!canReview && !topProjects.length && <p className="text-xs text-muted-foreground">{loading ? "Loading..." : "No project entries yet."}</p>}
      {personal && <p className="text-[10px] text-muted-foreground">Review destination: {role === "manager" ? "account manager" : "manager"}</p>}</div>
      {topProjects.length > 0 && <dl className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px]">{topProjects.map(([project, hours]) => <div key={project} className="flex min-w-0 max-w-full items-center gap-1.5"><dt className="max-w-32 truncate text-slate-600" title={project}>{project}</dt><dd className="shrink-0 font-medium tabular-nums text-slate-900">{hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h</dd></div>)}</dl>}
    </div>
  </section>
}
