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
type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string}

/**
 * Confirms an exact selection with mandatory reasons and human review checks.
 * @param props.rows - Selected current financial handoffs, at most fifty.
 * @param props.managers - Active receiving-manager choices returned by the API.
 * @param props.canAuthorize - Separate admin-granted eligibility authorization right.
 * @param props.onComplete - Reloads the queue after confirmed server success.
 * @returns JSX.Element containing the grouped operation button and confirmation window.
 */
export function BusinessAccountActions({ rows, managers, periods, canAuthorize, onComplete }: {
  rows: AccountHandoff[]; managers: { email: string }[]; periods:Period[]; canAuthorize: boolean; onComplete: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AccountHandoff[] | null>(null)
  const [action, setAction] = useState<AccountBatchAction>("return_manager")
  const [manager, setManager] = useState("")
  const [note, setNote] = useState("")
  const [correctionDueAt,setCorrectionDueAt]=useState("")
  const [flaggedByBatch,setFlaggedByBatch]=useState<Record<string,string>>({})
  const [checks, setChecks] = useState({ accuracy: false, compliance: false, housekeeping: false })
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  const pending = useRef(false)
  const correctionCap= snapshot?.length?Math.min(...snapshot.map(row=>{const period=periods.find(item=>row.evidence.date>=item.startDate&&row.evidence.date<=item.endDate);return Date.parse(period?.exceptionResolutionDeadline??period?.accountApprovalDeadline??period?.submissionDeadline??"")})):NaN
  const correctionCapLocal=Number.isFinite(correctionCap)?new Date(correctionCap-new Date(correctionCap).getTimezoneOffset()*60_000).toISOString().slice(0,16):undefined
  const effectiveCorrectionDueAt=correctionDueAt||correctionCapLocal||""
  const batchKey=(row:AccountHandoff)=>`${(row.evidence.ownerEmail||row.evidence.contractor).toLowerCase()}:${periods.find(item=>row.evidence.date>=item.startDate&&row.evidence.date<=item.endDate)?.id??`outside:${row.evidence.date}`}`
  const batches=Array.from(new Map((snapshot??[]).map(row=>[batchKey(row),(snapshot??[]).filter(candidate=>batchKey(candidate)===batchKey(row))])).entries())
  const hasOneFlagPerBatch=batches.every(([key,entries])=>entries.filter(row=>flaggedByBatch[key]===row.id).length===1)
  const recalledOnly=Boolean(snapshot?.length&&snapshot.every(row=>row.review_state==="reopened_for_review"))
  /**
   * Awaits one all-or-nothing, version-bound operation without automatic retries.
   * @returns Promise<void> after confirmed mutation or a visible failure retaining input.
   */
  async function confirm(): Promise<void> {
    if (pending.current || !snapshot?.length) return
    pending.current = true; setBusy(true); setError("")
    try {
      const response = await fetch(apiPath("/api/accounts"), { method: "PATCH", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, selection: snapshot.map(row => ({ id: row.id, version: row.review_version, ...(action === "return_submitter" ? { reject: flaggedByBatch[batchKey(row)] === row.id } : {}) })), note, checks, ...(action === "return_manager" ? { manager } : {}), ...(action==="return_manager"||action==="return_submitter"?{correctionDueAt:new Date(effectiveCorrectionDueAt).toISOString()}: {}) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Business-account action unavailable.")
      setSnapshot(null); onComplete()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action could not be confirmed. Refresh before retrying.") }
    finally { pending.current = false; setBusy(false) }
  }
  const eligible = (action !== "authorize_eligibility" || (canAuthorize && checks.accuracy && checks.compliance && checks.housekeeping)) && (action !== "return_submitter" || hasOneFlagPerBatch)
  return <>
    <Button variant="outline" title="Review complete timesheet batches, return them for correction, or complete final account review." disabled={!rows.length} onClick={() => { const next=rows.map(row => ({ ...row }));setSnapshot(next);setNote("");setManager("");setCorrectionDueAt("");setFlaggedByBatch({});setError("");setChecks({ accuracy: false, compliance: false, housekeeping: false });setAction("return_manager") }}><ListChecks className="size-4" />Actions ({rows.length})</Button>
    {snapshot && <WindowSurface title="Timesheet batch action" disabled={busy} onBack={() => setSnapshot(null)}><section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b border-sky-100 px-4 py-2"><h2 className="font-semibold">{batches.length} timesheets · {snapshot.length} entries</h2><p className="text-xs text-muted-foreground">{snapshot.reduce((sum, row) => sum + Number(row.evidence.hours), 0)}h</p></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"><div className="flex flex-wrap gap-2">
        <Button title={recalledOnly?"Override the issue or approve after correcting entries. Record the rationale below.":"Record final account-manager approval for every selected complete timesheet."} variant="outline" aria-pressed={action === "approve_timesheets"} disabled={busy} onClick={() => {setAction("approve_timesheets");setCorrectionDueAt("")}}><CheckCircle2 className="size-4"/>{recalledOnly?"Override & approve":"Approve timesheets"}</Button>
        <Button title="Return all selected timesheets to their assigned manager for correction." variant="outline" aria-pressed={action === "return_manager"} disabled={busy} onClick={() => {setAction("return_manager");setCorrectionDueAt("")}}><CornerUpLeft className="size-4" />To manager</Button>
        <Button title="Return complete timesheets to their submitters. Flag one entry per timesheet as the reason for rejection." variant="outline" aria-pressed={action === "return_submitter"} disabled={busy} onClick={() => {setAction("return_submitter");setCorrectionDueAt("")}}><CornerUpLeft className="size-4" />To submitter</Button>
        {canAuthorize && <Button variant="outline" aria-pressed={action === "authorize_eligibility"} disabled={busy} onClick={() => setAction("authorize_eligibility")}><CheckCircle2 className="size-4" />Authorize payout eligibility</Button>}
      </div>
      {action === "return_manager" && <label className="block text-sm">Manager<select aria-label="Receiving manager" disabled={busy} value={manager} onChange={event => setManager(event.target.value)} className="mt-1 block w-full max-w-lg rounded border bg-white p-2"><option value="">Choose manager</option>{managers.map(actor => <option key={actor.email}>{actor.email}</option>)}</select></label>}
      {(action === "return_manager"||action === "return_submitter")&&<label title="This deadline must be within the period's configured final resolution cutoff." className="grid gap-1 text-sm">Correction deadline<input aria-label="Correction deadline" type="datetime-local" required disabled={busy||!correctionCapLocal} min={new Date(Date.now()-new Date().getTimezoneOffset()*60_000).toISOString().slice(0,16)} max={correctionCapLocal} value={correctionDueAt||correctionCapLocal||""} onChange={event=>setCorrectionDueAt(event.target.value)} className="h-9 max-w-lg rounded border px-2"/></label>}
      {action === "authorize_eligibility" && <fieldset className="space-y-3 border-y py-3"><legend className="text-sm font-semibold">Human review checks</legend>{(["accuracy", "compliance", "housekeeping"] as const).map(key => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={checks[key]} onChange={event => setChecks(previous => ({ ...previous, [key]: event.target.checked }))} />{key === "accuracy" ? "Accuracy checked" : key === "compliance" ? "Compliance checked" : "Internal housekeeping complete"}</label>)}<p className="text-sm text-amber-800">Timesheet eligibility only. Monetary amounts and payments are not configured.</p></fieldset>}
      {action === "return_submitter"&&<div className="space-y-2"><h3 className="text-sm font-semibold">Flag one rejected entry in each timesheet</h3>{batches.map(([key,entries])=><fieldset key={key} className="rounded border border-red-200 bg-red-50/40 p-2"><legend className="px-1 text-xs font-semibold">{entries[0].evidence.contractor} · {periods.find(period=>period.id===key.split(":").at(-1))?.name??entries[0].evidence.date} · {entries.length} entries</legend>{entries.map(row=><label key={row.id} className="flex cursor-pointer items-start gap-2 border-t border-red-100 py-1.5 text-xs"><input type="radio" name={`reject-${key}`} aria-label={`Flag ${row.evidence.project} ${row.evidence.date} as rejected`} disabled={busy} checked={flaggedByBatch[key]===row.id} onChange={()=>setFlaggedByBatch(previous=>({...previous,[key]:row.id}))}/><span><strong>{row.evidence.project}</strong> · {row.evidence.date} · {row.evidence.hours}h<span className="block text-slate-600">{row.evidence.description}</span></span></label>)}</fieldset>)}</div>}
      <label className="block text-sm">{recalledOnly&&action==="approve_timesheets"?"Approval / override reason":"Reason"}<textarea aria-label={recalledOnly&&action==="approve_timesheets"?"Approval / override reason":"Reason / review note"} disabled={busy} value={note} maxLength={500} onChange={event => setNote(event.target.value)} className="mt-1 min-h-20 w-full rounded border p-2" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-white p-3"><Button variant="outline" disabled={busy} onClick={() => setSnapshot(null)}>Cancel</Button><Button disabled={busy || !eligible || !note.trim() || (action === "return_manager" && !manager)||((action==="return_manager"||action==="return_submitter")&&(!correctionCapLocal||!effectiveCorrectionDueAt))} onClick={() => void confirm()}>{busy ? "Saving..." : action==="approve_timesheets"?`${recalledOnly?"Override & approve":"Approve"} ${batches.length} timesheets`:action==="authorize_eligibility"?`Authorize ${batches.length} timesheets`:`Confirm ${batches.length} timesheets`}</Button></footer>
    </section></WindowSurface>}
  </>
}
