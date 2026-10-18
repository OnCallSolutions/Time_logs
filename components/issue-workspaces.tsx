"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCheck, ClipboardList, LoaderCircle, Send } from "lucide-react"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

export type IssueContext = { reference: string; operation: string; route: string; status?: number; message: string }
type Issue = {
  id: string; reference: string; reporterEmail: string; operation: string; route: string; httpStatus: number | null
  errorSignature: string; similarReports: number
  errorMessage: string; details: string; status: "open" | "investigating" | "waiting_on_reporter" | "resolved" | "closed"
  priority: "low" | "normal" | "high" | "urgent"; internalNote: string; createdAt: string; updatedAt: string; updatedBy: string | null
}
const statusLabels: Record<Issue["status"], string> = { open: "Open", investigating: "Investigating", waiting_on_reporter: "Waiting on reporter", resolved: "Resolved · dequeued", closed: "Closed" }
const priorityLabels: Record<Issue["priority"], string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" }

export function IssueReportWindow({ context, onClose }: { context: IssueContext; onClose: () => void }) {
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState(false)
  async function submit() {
    setBusy(true); setError("")
    try {
      const response = await fetch(apiPath("/api/issues"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...context, details }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? "Issue could not be sent.")
      setSubmitted(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Issue could not be sent.") }
    finally { setBusy(false) }
  }
  return <WindowSurface title={submitted ? "Issue sent to administrators" : "Report this failure"} compact resizable onBack={onClose}>
    <section className="w-full space-y-3 overflow-auto bg-white p-4">
      {submitted ? <div role="status" className="border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-semibold">The issue is now in the administrator queue.</p><p className="mt-1 text-xs">Reference: {context.reference}</p><p className="mt-1 text-xs">Administrators can investigate, repair, and resolve the issue.</p></div> : <>
        <div className="flex items-start gap-2 border-l-4 border-orange-500 bg-orange-50 p-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-800"/><div><p className="text-sm font-semibold text-orange-950">Failure details captured automatically</p><p className="mt-1 break-words text-xs text-orange-900">{context.operation} · {context.route}{context.status ? ` · HTTP ${context.status}` : ""}</p><p className="mt-1 break-words text-xs text-slate-700">{context.message}</p></div></div>
        <label className="block text-sm font-medium text-slate-900" htmlFor="issue-details">Additional notes <span className="font-normal text-slate-500">(optional)</span></label>
        <textarea id="issue-details" maxLength={3000} value={details} onChange={event => setDetails(event.target.value)} placeholder="What were you trying to do? What happened, and what did you expect?" className="min-h-28 w-full resize-y rounded-md border border-slate-300 p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" />
        <p className="text-xs text-slate-600">The technical context is read-only. Please do not include passwords or sensitive personal data. {details.length}/3000</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="button" onClick={submit} disabled={busy} className="bg-orange-700 text-white hover:bg-orange-800">{busy ? <LoaderCircle className="size-4 animate-spin"/> : <Send className="size-4"/>}Send report to admins</Button></div>
      </>}
      {submitted && <div className="flex justify-end"><Button type="button" onClick={onClose}>Done</Button></div>}
    </section>
  </WindowSurface>
}

export function AdminIssuesWorkspace({ onSummaryChange }: { onSummaryChange?: (summary: { open: number; urgent: number; uniqueErrors: number }) => void }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("active")
  const [timeFilter, setTimeFilter] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ status: Issue["status"]; priority: Issue["priority"]; internalNote: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = issues.find(issue => issue.id === selectedId) ?? null
  async function load() {
    setLoading(true); setError("")
    try {
      const response = await fetch(apiPath("/api/issues"), { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? "Issues could not be loaded.")
      const next = Array.isArray(payload.issues) ? payload.issues as Issue[] : []
      setIssues(next)
      onSummaryChange?.({ open: next.filter(issue => !["resolved", "closed"].includes(issue.status)).length, urgent: new Set(next.filter(issue => issue.status !== "resolved" && issue.status !== "closed" && issue.priority === "urgent").map(issue=>issue.errorSignature)).size, uniqueErrors: new Set(next.filter(issue => !["resolved", "closed"].includes(issue.status)).map(issue=>issue.errorSignature)).size })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Issues could not be loaded.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const filtered = useMemo(() => issues.filter(issue => {
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? !["resolved", "closed"].includes(issue.status) : issue.status === statusFilter)
    const haystack = `${issue.reporterEmail} ${issue.operation} ${issue.route} ${issue.errorMessage} ${issue.details} ${issue.reference}`.toLowerCase()
    const created=Date.parse(issue.createdAt)
    const age=Date.now()-created
    const matchesTime=timeFilter==="all"||(timeFilter==="today"&&new Date(created).toDateString()===new Date().toDateString())||(timeFilter==="7d"&&age<=7*86400000)||(timeFilter==="30d"&&age<=30*86400000)||(timeFilter==="month"&&new Date(created).getMonth()===new Date().getMonth()&&new Date(created).getFullYear()===new Date().getFullYear())
    return matchesStatus && matchesTime && haystack.includes(search.trim().toLowerCase())
  }), [issues, search, statusFilter, timeFilter])
  function select(issue: Issue) { setSelectedId(issue.id); setDraft({ status: issue.status, priority: issue.priority, internalNote: issue.internalNote }) }
  async function save() {
    if (!selected || !draft) return
    setSaving(true); setError("")
    try {
      const response = await fetch(apiPath("/api/issues"), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, ...draft }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? "Issue could not be updated.")
      setIssues(current => current.map(issue => issue.id === selected.id ? payload.issue as Issue : issue))
      setSelectedId(null); setDraft(null)
      const all = issues.map(issue => issue.id === selected.id ? payload.issue as Issue : issue)
      onSummaryChange?.({ open: all.filter(issue => !["resolved", "closed"].includes(issue.status)).length, urgent: new Set(all.filter(issue => issue.status !== "resolved" && issue.status !== "closed" && issue.priority === "urgent").map(issue=>issue.errorSignature)).size, uniqueErrors: new Set(all.filter(issue => !["resolved", "closed"].includes(issue.status)).map(issue=>issue.errorSignature)).size })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Issue could not be updated.") }
    finally { setSaving(false) }
  }
  return <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden bg-white p-3 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-gradient-to-r from-red-50 via-white to-orange-50 px-3 py-2"><div><h2 className="text-base font-semibold text-red-950">Issues and requests</h2><p className="text-xs text-slate-600">Investigate reported failures, coordinate repairs, and resolve completed items.</p></div><Button type="button" variant="outline" size="sm" onClick={()=>void load()} disabled={loading}><ClipboardList className="size-4"/>Refresh queue</Button></header>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><div className="border border-orange-200 bg-orange-50 p-2"><span className="text-xs text-orange-900">Active reports</span><strong className="block text-lg text-orange-950">{issues.filter(issue=>!["resolved","closed"].includes(issue.status)).length}</strong></div><div className="border border-sky-200 bg-sky-50 p-2"><span className="text-xs text-sky-900">Unique active errors</span><strong className="block text-lg text-sky-950">{new Set(issues.filter(issue=>!["resolved","closed"].includes(issue.status)).map(issue=>issue.errorSignature)).size}</strong></div><div className="border border-red-200 bg-red-50 p-2"><span className="text-xs text-red-900">Urgent patterns</span><strong className="block text-lg text-red-950">{new Set(issues.filter(issue=>issue.status!=="resolved"&&issue.status!=="closed"&&issue.priority==="urgent").map(issue=>issue.errorSignature)).size}</strong></div><div className="border border-blue-200 bg-blue-50 p-2"><span className="text-xs text-blue-900">All reports</span><strong className="block text-lg text-blue-950">{issues.length}</strong></div><div className="border border-emerald-200 bg-emerald-50 p-2"><span className="text-xs text-emerald-900">Resolved / closed</span><strong className="block text-lg text-emerald-950">{issues.filter(issue=>["resolved","closed"].includes(issue.status)).length}</strong></div></div>
    <div className="flex flex-wrap gap-2"><label htmlFor="issue-search" className="sr-only">Search issues</label><input id="issue-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search reporter, action, error, reference" className="h-9 min-w-52 flex-1 rounded-md border border-slate-300 px-3 text-sm"/><label htmlFor="issue-status" className="sr-only">Filter issues by status</label><select id="issue-status" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="active">Active queue</option><option value="all">All issues</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label htmlFor="issue-time" className="sr-only">Filter issues by time period</label><select id="issue-time" value={timeFilter} onChange={event=>setTimeFilter(event.target.value)} className="h-9 rounded-md border border-sky-300 bg-sky-50 px-2 text-sm"><option value="all">Any time period</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option></select></div>
    {error&&<p role="alert" className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]"><section aria-label="Issue queue" className="min-h-56 overflow-auto border border-slate-200"><h3 className="sticky top-0 z-[1] border-b border-slate-200 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase text-sky-950">Queue · {filtered.length} reports / {new Set(filtered.map(issue=>issue.errorSignature)).size} unique errors</h3>{loading?<p role="status" className="p-3 text-sm text-slate-600">Loading issues…</p>:filtered.length===0?<p className="p-3 text-sm text-slate-600">No issues match this view.</p>:filtered.map(issue=><button key={issue.id} type="button" onClick={()=>select(issue)} aria-current={selectedId===issue.id?"true":undefined} className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-sky-50 ${selectedId===issue.id?"bg-sky-50 ring-1 ring-inset ring-sky-300":"odd:bg-white even:bg-slate-50/60"}`}><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-slate-950">{issue.operation}</strong><span className="flex shrink-0 items-center gap-2"><span className="text-[11px] text-sky-800">{issue.similarReports} similar</span><span className={`text-[11px] font-semibold ${issue.priority==="urgent"?"text-red-700":issue.priority==="high"?"text-orange-800":"text-slate-600"}`}>{priorityLabels[issue.priority]}</span></span></span><span className="mt-1 block truncate text-xs text-slate-700">{issue.errorMessage}</span><span className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500"><span>{issue.reporterEmail}</span><span>{new Date(issue.createdAt).toLocaleString()}</span></span><span className="mt-1 inline-block text-[11px] text-sky-800">{statusLabels[issue.status]}</span></button>)}</section>
      <section aria-label="Issue details" className="min-w-0 border border-orange-200 bg-orange-50/30 p-3">{selected&&draft?<><div className="flex flex-wrap items-start justify-between gap-2 border-b border-orange-200 pb-2"><div><h3 className="text-sm font-semibold text-orange-950">Failure details</h3><p className="break-all text-[11px] text-slate-600">Reference {selected.reference}</p></div><span className="text-xs text-slate-600">Reported {new Date(selected.createdAt).toLocaleString()}</span></div><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="font-semibold text-slate-700">Reporter</dt><dd className="break-all">{selected.reporterEmail}</dd></div><div><dt className="font-semibold text-slate-700">Context</dt><dd>{selected.operation} · {selected.route}{selected.httpStatus?` · HTTP ${selected.httpStatus}`:""}</dd></div></dl><div className="mt-3 rounded border border-red-200 bg-white p-2"><h4 className="text-xs font-semibold text-red-900">Captured error</h4><p className="mt-1 break-words text-xs text-slate-800">{selected.errorMessage}</p></div><div className="mt-2 rounded border border-sky-200 bg-white p-2"><h4 className="text-xs font-semibold text-sky-900">Patron notes</h4><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-800">{selected.details||"No additional details provided."}</p></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700">Status<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as Issue["status"]})} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium text-slate-700">Priority<select value={draft.priority} onChange={event=>setDraft({...draft,priority:event.target.value as Issue["priority"]})} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div><label className="mt-3 block text-xs font-medium text-slate-700">Internal repair notes<textarea maxLength={3000} value={draft.internalNote} onChange={event=>setDraft({...draft,internalNote:event.target.value})} placeholder="Investigation, repair, or follow-up notes (admin only)" className="mt-1 min-h-20 w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm"/></label><div className="mt-3 flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>setDraft({...draft,status:"resolved"})}><CheckCheck className="size-4"/>Mark repaired · dequeue</Button><Button type="button" size="sm" onClick={save} disabled={saving}>{saving?<LoaderCircle className="size-4 animate-spin"/>:"Save triage"}</Button></div></>:<div className="flex h-full min-h-48 flex-col items-center justify-center text-center text-slate-500"><ClipboardList className="size-7 text-sky-600"/><p className="mt-2 text-sm font-medium">Select an issue</p><p className="mt-1 text-xs">Captured context, reporter notes, and repair controls will appear here.</p></div>}</section></div>
  </div>
}
