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
  return <section aria-label="Workspace snapshot" className="grid gap-4 border-y border-border bg-white py-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
    <div className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{personal ? "My work at a glance" : "Authorized work at a glance"}</h2><span className="text-xs text-muted-foreground">{loading ? "Loading..." : `${scope.length} entries / ${projects.size} projects`}</span></div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-4">{metrics.map(({ status, label, icon: Icon, color, background }) => {
        const rows = scope.filter(entry => entry.status === status)
        return <div key={status} className={`${background} min-w-0 p-3`}><dt className={`flex items-center gap-2 text-xs font-medium ${color}`}><Icon className="size-4 shrink-0" />{label}</dt><dd className={`mt-2 text-2xl font-semibold tabular-nums ${color}`}>{loading ? "..." : rows.length}</dd><dd className="mt-1 text-xs text-muted-foreground">{rows.reduce((sum, entry) => sum + entry.hours, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}h</dd></div>
      })}</dl>
    </div>
    <div className="min-w-0 border-t pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><h2 className="text-sm font-semibold">{canReview ? "Review workload" : "Project activity"}</h2>
      {canReview && <p className="mt-2 text-sm"><strong className="text-blue-800">{review.length}</strong> awaiting your review / {review.reduce((sum, entry) => sum + entry.hours, 0).toLocaleString()}h</p>}
      <dl className="mt-2 divide-y text-sm">{topProjects.map(([project, hours]) => <div key={project} className="flex min-w-0 justify-between gap-3 py-2"><dt className="min-w-0 break-words">{project}</dt><dd className="shrink-0 font-medium tabular-nums">{hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h</dd></div>)}</dl>
      {!topProjects.length && <p className="mt-3 text-sm text-muted-foreground">{loading ? "Loading project activity..." : "No project entries yet."}</p>}
      {personal && <p className="mt-2 text-xs text-muted-foreground">Review destination: {role === "manager" ? "account manager" : "manager"}</p>}
    </div>
  </section>
}
