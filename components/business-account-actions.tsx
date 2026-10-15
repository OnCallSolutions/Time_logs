/**
 * Provides explicit single/bulk business-account returns and eligibility decisions.
 * The server atomically checks every source revision and writes an audit per item.
 * Eligibility is not an amount calculation, bank transfer, or automatic AI decision.
 */
"use client"
import { useRef, useState } from "react"
import { CheckCircle2, CornerUpLeft, ListChecks } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import type { AccountHandoff, AccountBatchAction } from "@/lib/account-handoffs"

/**
 * Confirms an exact selection with mandatory reasons and human review checks.
 * @param props.rows - Selected current financial handoffs, at most fifty.
 * @param props.managers - Active receiving-manager choices returned by the API.
 * @param props.canAuthorize - Separate admin-granted eligibility authorization right.
 * @param props.onComplete - Reloads the queue after confirmed server success.
 * @returns JSX.Element containing the grouped operation button and confirmation window.
 */
export function BusinessAccountActions({ rows, managers, canAuthorize, onComplete }: {
  rows: AccountHandoff[]; managers: { email: string }[]; canAuthorize: boolean; onComplete: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AccountHandoff[] | null>(null)
  const [action, setAction] = useState<AccountBatchAction>("return_manager")
  const [manager, setManager] = useState("")
  const [note, setNote] = useState("")
  const [checks, setChecks] = useState({ accuracy: false, compliance: false, housekeeping: false })
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  const pending = useRef(false)
  /**
   * Awaits one all-or-nothing, version-bound operation without automatic retries.
   * @returns Promise<void> after confirmed mutation or a visible failure retaining input.
   */
  async function confirm(): Promise<void> {
    if (pending.current || !snapshot?.length) return
    pending.current = true; setBusy(true); setError("")
    try {
      const response = await fetch(apiPath("/api/accounts"), { method: "PATCH", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, selection: snapshot.map(row => ({ id: row.id, version: row.review_version })), note, checks, ...(action === "return_manager" ? { manager } : {}) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Business-account action unavailable.")
      setSnapshot(null); onComplete()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action could not be confirmed. Refresh before retrying.") }
    finally { pending.current = false; setBusy(false) }
  }
  const eligible = action !== "authorize_eligibility" || (canAuthorize && checks.accuracy && checks.compliance && checks.housekeeping)
  return <>
    <Button variant="outline" disabled={!rows.length} onClick={() => { setSnapshot(rows.map(row => ({ ...row }))); setNote(""); setManager(""); setError(""); setChecks({ accuracy: false, compliance: false, housekeeping: false }); setAction("return_manager") }}><ListChecks className="size-4" />Actions for selected ({rows.length})</Button>
    {snapshot && <WindowSurface title="Business-account timesheet action" disabled={busy} onBack={() => setSnapshot(null)}><section className="flex min-h-0 w-full flex-col bg-white">
      <header className="shrink-0 border-b p-4"><h2 className="font-semibold">{snapshot.length} selected timesheets</h2><p className="text-sm text-muted-foreground">{snapshot.reduce((sum, row) => sum + Number(row.evidence.hours), 0)} hours</p></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4"><div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={action === "return_manager"} disabled={busy} onClick={() => setAction("return_manager")}><CornerUpLeft className="size-4" />Return to manager</Button>
        <Button variant="outline" aria-pressed={action === "return_submitter"} disabled={busy} onClick={() => setAction("return_submitter")}><CornerUpLeft className="size-4" />Return to submitters</Button>
        {canAuthorize && <Button variant="outline" aria-pressed={action === "authorize_eligibility"} disabled={busy} onClick={() => setAction("authorize_eligibility")}><CheckCircle2 className="size-4" />Authorize payout eligibility</Button>}
      </div>
      {action === "return_manager" && <label className="block text-sm">Receiving manager<select aria-label="Receiving manager" disabled={busy} value={manager} onChange={event => setManager(event.target.value)} className="mt-1 block w-full max-w-lg rounded border bg-white p-2"><option value="">Choose manager</option>{managers.map(actor => <option key={actor.email}>{actor.email}</option>)}</select></label>}
      {action === "authorize_eligibility" && <fieldset className="space-y-3 border-y py-3"><legend className="text-sm font-semibold">Human review checks</legend>{(["accuracy", "compliance", "housekeeping"] as const).map(key => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={checks[key]} onChange={event => setChecks(previous => ({ ...previous, [key]: event.target.checked }))} />{key === "accuracy" ? "Accuracy checked" : key === "compliance" ? "Compliance checked" : "Internal housekeeping complete"}</label>)}<p className="text-sm text-amber-800">Timesheet eligibility only. Monetary amounts and payments are not configured.</p></fieldset>}
      <label className="block text-sm">Reason / review note<textarea aria-label="Reason / review note" disabled={busy} value={note} maxLength={500} onChange={event => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded border p-2" /></label>
      <div className="divide-y">{snapshot.map(row => <article key={row.id} className="py-3 text-sm"><h3 className="font-semibold">{row.evidence.contractor} / {row.evidence.project} / {row.evidence.date}</h3><p>{row.evidence.hours}h / {row.evidence.description}</p></article>)}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={() => setSnapshot(null)}>Cancel</Button><Button disabled={busy || !eligible || !note.trim() || (action === "return_manager" && !manager)} onClick={() => void confirm()}>{busy ? "Saving..." : `Confirm ${snapshot.length} timesheets`}</Button></footer>
    </section></WindowSurface>}
  </>
}
