"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, CircleAlert, Loader2, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type ConnectionStatus = {
  connected: boolean
  connectedAccount: string | null
  connectedAt: string | null
  attendeeIdentityEnabled: boolean
  subscriptionActive: boolean
  subscriptionExpiresAt: string | null
  developmentProcessingAvailable: boolean
}

export function TeamsTranscriptConnect() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [processingMessage, setProcessingMessage] = useState("")
  const [backfillFrom, setBackfillFrom] = useState(() => localDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
  const [backfillThrough, setBackfillThrough] = useState(() => localDateInput(new Date()))
  const [backfillBusy, setBackfillBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(apiPath("/api/teams/connect/status"), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? "Connection status unavailable.")
        setStatus(data)
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connection status unavailable.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const result = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("teamsConnection") ?? ""
  const resultMessage = result === "connected" ? "Teams is connected and transcript notifications are active."
    : result === "subscription-pending" ? "Account connected, but transcript notifications are not active yet. Check tenant permissions and subscription setup."
      : result === "failed" ? "Teams connection did not complete. Check the app registration and server configuration, then retry." : ""

  async function processDevelopmentQueue() {
    setProcessing(true)
    setProcessingMessage("")
    try {
      const response = await fetch(apiPath("/api/teams/transcripts/dev/process"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Development processing failed.")
      setProcessingMessage(`Processed ${data.fetched.processed} transcript${data.fetched.processed === 1 ? "" : "s"}; prepared ${data.extracted.savedDrafts} draft${data.extracted.savedDrafts === 1 ? "" : "s"}.`)
      window.dispatchEvent(new Event("teams-transcript-drafts-updated"))
    } catch (cause) {
      setProcessingMessage(cause instanceof Error ? cause.message : "Development processing failed.")
    } finally {
      setProcessing(false)
    }
  }

  async function findPastTranscripts() {
    setBackfillBusy(true)
    setProcessingMessage("")
    try {
      const response = await fetch(apiPath("/api/teams/transcripts/backfill"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: backfillFrom, through: backfillThrough }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Past transcript search failed.")
      setProcessingMessage(`Checked ${data.meetingsChecked} meetings and found ${data.found} past transcript${data.found === 1 ? "" : "s"}; queued ${data.queued} for processing${data.duplicates ? ` (${data.duplicates} already queued)` : ""}.${data.truncated ? " The search reached its meeting limit; narrow the date range to find more." : ""}`)
      if (data.queued > 0) window.dispatchEvent(new Event("teams-transcript-drafts-updated"))
    } catch (cause) {
      setProcessingMessage(cause instanceof Error ? cause.message : "Past transcript search failed.")
    } finally {
      setBackfillBusy(false)
    }
  }

  return <section aria-label="Microsoft Teams transcript connection" className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-sky-200 bg-sky-50/60 px-3 py-2">
    <div className="flex min-w-0 items-start gap-2">
      <Video className="mt-0.5 size-4 shrink-0 text-sky-800" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">Teams meeting transcripts</h3>
        {loading ? <p className="text-xs text-slate-600">Checking connection…</p>
          : error ? <p role="alert" className="text-xs text-red-800">{error}</p>
            : status?.connected ? <p className="text-xs text-slate-700">Connected: {status.connectedAccount}. {status.subscriptionActive ? "Transcript notifications active." : "Transcript notifications need attention."} {status.attendeeIdentityEnabled ? "Speaker identity matching enabled." : "Reconnect to grant attendee identity access."}</p>
              : <p className="text-xs text-slate-700">Connect your work account to use transcripts from meetings you organize.</p>}
        {resultMessage && <p role="status" className="mt-1 flex items-center gap-1 text-xs text-slate-700">{result === "connected" ? <CheckCircle2 className="size-3 text-emerald-700"/> : <CircleAlert className="size-3 text-orange-700"/>}{resultMessage}</p>}
        {status?.subscriptionExpiresAt && <p className="text-xs text-slate-600">Subscription expires {new Date(status.subscriptionExpiresAt).toLocaleString()}.</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {status?.developmentProcessingAvailable && <Button type="button" size="sm" variant="outline" disabled={processing} onClick={() => void processDevelopmentQueue()}>
        {processing ? <Loader2 className="size-4 animate-spin"/> : <Video className="size-4"/>}
        {processing ? "Processing…" : "Process queued transcripts"}
      </Button>}
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => window.location.assign(apiPath("/api/teams/connect"))}>
        {loading ? <Loader2 className="size-4 animate-spin"/> : <Video className="size-4"/>}
        {status?.connected ? "Reconnect Teams" : "Connect Teams"}
      </Button>
    </div>
    {status?.connected && <div className="flex w-full flex-wrap items-end gap-2 border-t border-sky-200 pt-2">
      <label className="grid gap-1 text-xs text-slate-700">Past meetings from<input type="date" value={backfillFrom} max={backfillThrough} onChange={event => setBackfillFrom(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs text-slate-700">Through<input type="date" value={backfillThrough} min={backfillFrom} max={localDateInput(new Date())} onChange={event => setBackfillThrough(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-sm"/></label>
      <Button type="button" size="sm" variant="outline" disabled={backfillBusy || !backfillFrom || !backfillThrough} onClick={() => void findPastTranscripts()}>
        {backfillBusy ? <Loader2 className="size-4 animate-spin"/> : <Video className="size-4"/>}
        {backfillBusy ? "Searching…" : "Find past transcripts"}
      </Button>
      <p className="basis-full text-xs text-slate-600">Searches up to 90 days for meetings organized by this connected account. Existing transcripts are deduplicated.</p>
    </div>}
    {processingMessage && <p role="status" className="w-full text-xs text-slate-700">{processingMessage}</p>}
  </section>
}

function localDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
