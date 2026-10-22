"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, CircleAlert, LoaderCircle, Radio, Search } from "lucide-react"

type TranscriptSource = {
  ownerEmail: string
  connectedAccount: string
  connectedAt: string
  captureEnabled: boolean
  subscriptionActive: boolean
  subscriptionExpiresAt: string | null
}

/** Admin control for which connected organizer accounts may feed transcript capture. */
export function TeamsTranscriptSources() {
  const [sources, setSources] = useState<TranscriptSource[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [busyOwner, setBusyOwner] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/admin/teams-transcript-sources", { cache: "no-store" })
      const body = await response.json() as { sources?: TranscriptSource[]; error?: string }
      if (!response.ok) throw new Error(body.error || "Could not load connected organizer accounts.")
      setSources(body.sources ?? [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load connected organizer accounts.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function setEnabled(source: TranscriptSource, enabled: boolean) {
    setBusyOwner(source.ownerEmail)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/admin/teams-transcript-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: source.ownerEmail, enabled }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error || "Could not update transcript capture.")
      setSources(current => current.map(item => item.ownerEmail === source.ownerEmail ? { ...item, captureEnabled: enabled } : item))
      setNotice(`Transcript capture ${enabled ? "enabled" : "paused"} for ${source.connectedAccount}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update transcript capture.")
    } finally {
      setBusyOwner(null)
    }
  }

  const visible = sources.filter(source => `${source.connectedAccount} ${source.ownerEmail}`.toLowerCase().includes(search.trim().toLowerCase()))

  return <section aria-labelledby="teams-transcript-sources-title" className="border border-slate-200 bg-white">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
      <div className="flex items-center gap-2"><Radio aria-hidden="true" className="size-4 text-orange-700"/><div><h3 id="teams-transcript-sources-title" className="text-sm font-semibold text-slate-950">Teams transcript sources</h3><p className="text-xs text-slate-600">Choose which connected organizer accounts can supply meeting transcripts.</p></div></div>
      <span className="text-xs text-slate-600">{sources.filter(source => source.captureEnabled).length} active · {sources.length} connected</span>
    </header>
    <div className="space-y-3 p-3">
      <p className="text-xs text-slate-600">Each organizer connects their own Microsoft account. Enabling an account captures meetings organized by that person; it does not select an entire Team or channel.</p>
      {sources.length > 0 && <label className="relative block"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"/><input aria-label="Search organizer accounts" className="h-9 w-full border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-500" placeholder="Search organizer accounts" value={search} onChange={event => setSearch(event.target.value)}/></label>}
      {error && <p role="alert" className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><CircleAlert className="size-4 shrink-0"/>{error}</p>}
      {notice && <p role="status" className="flex items-center gap-2 text-sm text-emerald-800"><Check className="size-4"/>{notice}</p>}
      {loading ? <p className="flex items-center gap-2 py-3 text-sm text-slate-600"><LoaderCircle className="size-4 animate-spin"/>Loading connected organizer accounts…</p>
        : sources.length === 0 ? <p className="border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-600">No organizer accounts are connected yet. Each organizer can connect Teams from the AI timesheet extraction page.</p>
        : visible.length === 0 ? <p className="py-4 text-center text-sm text-slate-600">No connected organizer accounts match this search.</p>
        : <ul className="divide-y divide-slate-200 border border-slate-200">{visible.map(source => <li key={source.ownerEmail} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-950">{source.connectedAccount}</p><p className="text-xs text-slate-600">App account: {source.ownerEmail} · {source.subscriptionActive ? "Transcript notifications active" : "Transcript subscription inactive"}</p></div>
          <label className="inline-flex shrink-0 items-center gap-2 text-sm text-slate-800"><input aria-label={`${source.captureEnabled ? "Pause" : "Enable"} capture for ${source.connectedAccount}`} type="checkbox" checked={source.captureEnabled} disabled={busyOwner !== null} onChange={event => void setEnabled(source, event.target.checked)} className="size-4 accent-orange-700"/>{busyOwner === source.ownerEmail && <LoaderCircle className="size-4 animate-spin"/>}{source.captureEnabled ? "Capture on" : "Capture paused"}</label>
        </li>)}</ul>}
    </div>
  </section>
}
