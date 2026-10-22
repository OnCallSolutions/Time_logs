/**
 * Sends an encrypted high-priority review request for an explicit timesheet snapshot.
 * The API atomically stores the notice and short-lived revision-scoped grants.
 * Missing device keys never trigger plaintext fallback or silent permission grants.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { Send } from "lucide-react"
import { WindowSurface } from "./window-surface"
import { Button } from "./ui/button"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import type { useMessageEncryption } from "./use-message-encryption"

/**
 * Captures a receiving manager and reason, then encrypts before granting access.
 * @param props.entries - Explicit submitted evidence/revisions, up to fifty.
 * @param props.email - Authenticated requesting identity.
 * @param props.encryption - Existing automatically connected browser encryption state.
 * @param props.onClose - Dismisses without granting or sending anything.
 * @param props.onComplete - Refreshes requests and inbox after confirmed success.
 * @returns JSX.Element containing the request confirmation window.
 */
export function ReviewerHelpDialog({ entries, email, encryption, onClose, onComplete }: {
  entries: TimeEntry[]; email: string; encryption: ReturnType<typeof useMessageEncryption>; onClose: () => void; onComplete: () => void;
}) {
  const [reviewers, setReviewers] = useState<{ email: string; displayName?: string }[]>([])
  const [recipient, setRecipient] = useState(""), [note, setNote] = useState("")
  const [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [messageId] = useState(() => crypto.randomUUID())
  const pending = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(apiPath("/api/review-requests"), { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setReviewers((data.reviewers ?? []).filter((actor: { email: string }) => !entries.some(entry => entry.ownerEmail?.toLowerCase() === actor.email.toLowerCase())))
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Reviewer choices unavailable.") })
    return () => controller.abort()
  }, [entries])
  /**
   * Encrypts the notice and awaits the atomic scoped-grant/message operation.
   * @returns Promise<void> after confirmation or a visible failure preserving input.
   */
  async function send(): Promise<void> {
    if (pending.current || !recipient || !note.trim() || !encryption.unlocked) return
    pending.current = true; setBusy(true); setError("")
    try {
      if (entries.some(entry => !entry.revision)) throw new Error("Refresh these timesheets before requesting assistance.")
      const body = `High-priority review request: ${entries.length} timesheets. Open Reviews in Tanovo Time.\n${note.trim()}\nTimesheet IDs: ${entries.map(entry => entry.id).join(", ")}`
      const encrypted = await encryption.encrypt(body, recipient, [email, recipient])
      const response = await fetch(apiPath("/api/review-requests"), { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: entries.map(entry => ({ id: entry.id, revision: entry.revision })), recipient, messageId, encrypted }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Request was not confirmed; refresh before retrying.")
      onComplete()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request was not confirmed. Refresh before retrying.") }
    finally { pending.current = false; setBusy(false) }
  }
  return <WindowSurface title="Request reviewer help" disabled={busy} onBack={onClose}><section className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto bg-white">
    <header className="shrink-0 border-b p-4"><h2 className="font-semibold">High-priority reviewer request</h2><p className="text-sm text-muted-foreground">{entries.length} submitted timesheets / 48-hour scoped access</p></header>
    <div className="space-y-4 p-4"><label className="block text-sm">Receiving manager<select aria-label="Receiving manager" disabled={busy} value={recipient} onChange={event => setRecipient(event.target.value)} className="mt-1 block w-full max-w-lg rounded border bg-white p-2"><option value="">Choose another manager</option>{reviewers.map(actor => <option key={actor.email} value={actor.email}>{actor.displayName || actor.email} / {actor.email}</option>)}</select></label>
      <label className="block text-sm">Request reason<textarea aria-label="Request reason" maxLength={1000} disabled={busy} value={note} onChange={event => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded border p-2" /></label>
      {entries.map(entry => <article key={entry.id} className="border-b py-2 text-sm"><strong>{entry.contractor} / {entry.project}</strong><p>{entry.date} / {entry.hours}h / {entry.description}</p></article>)}
      {!encryption.unlocked && <p role="status" className="text-sm text-amber-800">Secure messaging is connecting. No request has been granted or sent.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div><footer className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !recipient || !note.trim() || !encryption.unlocked || entries.length > 50} onClick={() => void send()}><Send className="size-4" />{busy ? "Sending..." : "Grant scoped access and send"}</Button></footer>
  </section></WindowSurface>
}
