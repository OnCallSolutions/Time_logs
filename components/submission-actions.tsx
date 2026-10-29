/**
 * Coordinates explicit manual or AI-assisted submission of selected owned entries.
 * AI batches are advisory; only a separate human confirmation changes workflow state.
 * Partial success is reported honestly, with confirmed rows removed from retry scope.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import type { EntryTransition } from "@/components/entry-log-row"

type Advice = { entryId: string; revision: string; readiness: "ready" | "needs_attention"; reason: string }

/**
 * Presents a reviewable snapshot and awaits individual, revision-bound submissions.
 * @param props.entries - Selected, owned draft/rejected entries from the current view.
 * @param props.destination - Server-enforced review lane, never an invented assignee.
 * @param props.onStatusChange - Awaitable existing submission mutation.
 * @param props.onSubmitted - Removes a confirmed record from the current selection.
 * @returns JSX.Element containing manual/AI controls and the confirmation window.
 */
export function SubmissionActions({ entries, destination = "manager", onStatusChange, onSubmitted, openRequest = 0 }: {
  entries: TimeEntry[]; destination?: "manager" | "account_manager" | "self"; onStatusChange: EntryTransition; onSubmitted: (id: string) => void;
  openRequest?: number;
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"manual" | "ai">("manual")
  const [snapshot, setSnapshot] = useState<TimeEntry[]>([])
  const [advice, setAdvice] = useState<Advice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [completed, setCompleted] = useState(0)
  const [manager,setManager]=useState<{email:string;displayName:string;assignment:"added_by_manager"|"available_manager"}|null>(null)
  const pending = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(()=>{if(openRequest>0)prepareManual()},[openRequest])
  useEffect(()=>{
    if(!open||destination!=="manager")return
    const abort=new AbortController()
    setManager(null);setError("")
    fetch(apiPath("/api/submission-managers"),{cache:"no-store",signal:abort.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);const assigned=data.manager??null;setManager(assigned);if(!assigned)setError("No active manager currently has both team-view and approval rights. Ask an admin to assign a reviewer before submitting.")}).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:"Manager assignment unavailable.")})
    return()=>abort.abort()
  },[open,destination])
  const analyzing = busy && mode === "ai" && advice.length === 0
  const target = destination === "self" ? "Submit for your final approval" : destination === "account_manager" ? "Account-manager review" : "Manager review"
  const totalHours = snapshot.reduce((sum, entry) => sum + entry.hours, 0)
  const currentEntries = new Map(entries.map(entry => [entry.id, entry]))
  const adviceById = new Map(advice.map(item => [item.entryId, item]))
  const currentSnapshot = snapshot.every(entry => {
    const current = currentEntries.get(entry.id)
    return current?.revision === entry.revision && !!current && ["draft", "rejected"].includes(current.status)
  })

  /**
   * Captures the selected records without changing any saved state.
   * @returns void; Cancel/Back can discard the entire proposed submission.
   */
  function prepareManual(): void {
    setMode("manual"); setSnapshot(entries.map(entry => ({ ...entry }))); setAdvice([]); setError(""); setCompleted(0); setOpen(true)
  }

  /**
   * Cancels read-only analysis; confirmed writes cannot be dismissed mid-operation.
   * @returns void after aborting the pending analysis or closing an idle preview.
   */
  function close(): void {
    if (analyzing) controller.current?.abort()
    else if (pending.current) return
    setOpen(false)
  }

  /**
   * Loads grounded advice in batches of at most fifty, including all selected rows.
   * @returns Promise<void> after analysis only; never submits or edits evidence.
   */
  async function analyze(): Promise<void> {
    if (pending.current || !entries.length) return
    pending.current = true
    const records = entries.map(entry => ({ ...entry }))
    setMode("ai"); setSnapshot(records); setAdvice([]); setError(""); setCompleted(0); setOpen(true); setBusy(true)
    const abort = new AbortController()
    controller.current = abort
    try {
      if (records.some(entry => !entry.revision)) throw new Error("Refresh entries before preparing AI submission; saved revisions are unavailable.")
      const results: Advice[] = []
      for (let index = 0; index < records.length; index += 50) {
        const batch = records.slice(index, index + 50)
        const response = await fetch(apiPath("/api/entries/prepare-submission"), { method: "POST", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: batch.map(entry => ({ id: entry.id, revision: entry.revision })) }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? "Submission assistance unavailable.")
        if (!Array.isArray(data.items) || data.items.length !== batch.length || new Set(data.items.map((item: Advice) => item.entryId)).size !== batch.length || data.items.some((item: Advice) => !batch.some(entry => entry.id === item.entryId && entry.revision === item.revision))) throw new Error("AI evidence changed or was incomplete. Refresh and prepare again.")
        results.push(...data.items)
      }
      setAdvice(results)
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name) ? "Analysis timed out. No entries were submitted; try a smaller selection." : cause instanceof Error ? cause.message : "Submission assistance unavailable.")
    } finally { pending.current = false; setBusy(false) }
  }

  /**
   * Submits the explicitly confirmed snapshot, stopping at the first failed row.
   * @returns Promise<void> after confirmed progress or a recoverable partial failure.
   */
  async function submit(): Promise<void> {
    if (pending.current || !snapshot.length || !currentSnapshot || (destination==="manager"&&!manager)) return
    pending.current = true
    setBusy(true); setError("")
    try {
      for (const entry of snapshot) {
        await onStatusChange(entry.id, "submitted", undefined, entry.revision,...(destination==="manager"?[manager!.email]:[]))
        onSubmitted(entry.id)
        setCompleted(count => count + 1)
        setSnapshot(previous => previous.filter(current => current.id !== entry.id))
      }
      setOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Submission failed. Confirmed entries remain submitted.") }
    finally { pending.current = false; setBusy(false) }
  }

  return <>
    <Button size="sm" variant="outline" disabled={!entries.length || busy} onClick={prepareManual}><Send className="size-4" />Submit selected ({entries.length})</Button>
    {destination!=="self"&&<Button size="sm" disabled={!entries.length || busy} onClick={() => void analyze()}><Sparkles className="size-4" />AI prepare selected ({entries.length})</Button>}
    {!open && completed > 0 && <p role="status" className="text-sm text-green-800">{completed} {destination === "self" ? "entries submitted for your approval." : "entries submitted for review."}</p>}
    {open && <WindowSurface title={mode === "ai" ? "AI submission preparation" : "Confirm submission"} disabled={busy && !analyzing} onBack={close}>
      <section className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto bg-white">
        <header className="shrink-0 border-b px-4 py-3"><h2 className="font-semibold">{target}</h2><p className="text-sm text-muted-foreground">{snapshot.length} remaining / {totalHours.toLocaleString()}h / {completed} submitted</p></header>
        <div className="space-y-1 p-4">
          {destination==="manager"&&<div aria-label="Reviewing manager" className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"><p className="text-xs font-semibold uppercase text-blue-800">Assigned reviewing manager</p>{manager?<><p className="mt-1 font-semibold text-blue-950">{manager.displayName}</p><p className="text-xs text-blue-800">{manager.assignment==="added_by_manager"?"Assigned because this manager added your account.":"Assigned from the currently available authorized managers."}</p></>:<p role="status" className="mt-1 text-blue-900">Finding your reviewing manager...</p>}</div>}
          {busy && <p role="status" className="mb-3 text-sm">{advice.length || mode === "manual" ? "Submitting confirmed entries..." : "Preparing selected entries..."}</p>}
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
          {!currentSnapshot && <p role="alert" className="mb-3 text-sm text-destructive">Selection changed. Close this window and select current entries again.</p>}
          {snapshot.map(entry => {
            const item = adviceById.get(entry.id)
            return <article key={entry.id} className="grid gap-2 border-b py-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><h3 className="text-sm font-semibold">{entry.project} / {entry.date}</h3><p className="whitespace-pre-wrap break-words text-sm">{entry.description || "No description"}</p>{item && <p className={`mt-2 text-sm ${item.readiness === "ready" ? "text-green-800" : "text-amber-800"}`}><strong>{item.readiness === "ready" ? "Ready" : "Needs attention"}:</strong> {item.reason}</p>}</div><span className="text-sm tabular-nums">{entry.hours}h</span></article>
          })}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" disabled={busy && !analyzing} onClick={close}>Cancel</Button>
          <Button disabled={busy || !snapshot.length || !currentSnapshot || (destination==="manager"&&!manager) || (mode === "ai" && advice.length === 0)} onClick={() => void submit()}><Send className="size-4" />Confirm submission ({snapshot.length})</Button>
        </footer>
      </section>
    </WindowSurface>}
  </>
}
