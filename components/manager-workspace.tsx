/**
 * Provides manager navigation and explicit approval decision dialogs.
 * Existing team editing and reports remain available through their original views.
 * Review decisions require confirmation, with a mandatory reason for rejection.
 */
"use client"
import { useState } from "react"
import { BarChart3, CheckCircle2, Sparkles, XCircle } from "lucide-react"
import { apiPath } from "@/lib/paths"
import { Button } from "@/components/ui/button"
import { useDialogFocus } from "@/components/use-dialog-focus"
import type { TimeEntry } from "@/lib/types"

/**
 * Renders manager shortcuts to the approval queue and existing team reports.
 * @param props.pending - Number of submitted entries awaiting review.
 * @param props.entries - Currently submitted records used to discard stale advice.
 * @param props.onApprovals - Callback that opens the existing approval queue.
 * @param props.onReports - Callback that opens the existing report view.
 * @param props.onRecommendation - Callback opening a human decision dialog.
 * @returns JSX.Element containing manager navigation controls.
 */
export function ManagerWorkspace({ pending, entries, onApprovals, onReports, onRecommendation }: {
  pending: number; entries: TimeEntry[]; onApprovals: () => void; onReports: () => void;
  onRecommendation: (entry: TimeEntry, decision: "approved" | "rejected", reason: string) => void
}) {
  const [recommendations,setRecommendations] = useState<{entryId:string;decision:"approved"|"rejected"|"needs_review";reason:string}[]>([])
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState<string|null>(null)
  /**
   * Loads AI suggestions without applying any approval or rejection transitions.
   * @returns Promise<void> after advisory results or failure are displayed.
   */
  async function prepareReview(): Promise<void> {
    setLoading(true); setError(null)
    try {
      const response = await fetch(apiPath("/api/review"),{method:"POST"})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setRecommendations(data.recommendations)
    } catch(error) { setError(error instanceof Error ? error.message : "AI review unavailable.") }
    finally { setLoading(false) }
  }
  return <section aria-label="Manager workflow" className="space-y-3">
    <div className="flex flex-wrap gap-2">
    <Button disabled={loading || !pending} onClick={prepareReview}><Sparkles className="size-4" />{loading ? "Preparing review..." : "Prepare AI review"}</Button>
    <Button onClick={onApprovals}><CheckCircle2 className="size-4" />Review queue <span>{pending}</span></Button>
    <Button variant="outline" onClick={onReports}><BarChart3 className="size-4" />Team report</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {recommendations.filter(item => entries.some(entry => entry.id === item.entryId && entry.status === "submitted")).map(item => {
      const entry = entries.find(entry => entry.id === item.entryId)!
      return <div key={item.entryId} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{entry.contractor} - {entry.date} - {entry.hours}h</p><p className="text-sm">Suggested: {item.decision.replace("_"," ")}</p><p className="break-words text-sm text-muted-foreground">{item.reason}</p></div>
        {item.decision === "needs_review" ? <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onRecommendation(entry,"approved",item.reason)}>Review for approval</Button>
          <Button variant="outline" onClick={() => onRecommendation(entry,"rejected",item.reason)}>Review for rejection</Button>
        </div> : <Button variant="outline" onClick={() => onRecommendation(entry,item.decision as "approved"|"rejected",item.reason)}>Review suggestion</Button>}
      </div>
    })}
  </section>
}

/**
 * Presents entry evidence and collects a confirmed approval or rejection decision.
 * @param props.entry - Submitted entry selected for review.
 * @param props.decision - Intended workflow transition.
 * @param props.initialNote - Optional AI explanation for human review and editing.
 * @param props.onCancel - Callback that dismisses the dialog without mutation.
 * @param props.onConfirm - Callback receiving the trimmed review note.
 * @returns JSX.Element containing the approval decision dialog.
 */
export function EntryReviewDialog({ entry, decision, initialNote = "", onCancel, onConfirm }: {
  entry: TimeEntry; decision: "approved" | "rejected"; initialNote?: string; onCancel: () => void; onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState(initialNote)
  const ref = useDialogFocus(onCancel)
  const rejecting = decision === "rejected"
  const title = rejecting ? "Reject entry" : "Approve entry"
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-xl">
      <h2 className="shrink-0 border-b p-4 text-base font-semibold">{title}</h2>
      <div className="min-h-0 overflow-auto p-4">
        <p className="font-medium">{entry.contractor}</p><p>{entry.date} - {entry.hours}h - {entry.project}</p>
        <p className="my-3 whitespace-pre-wrap break-words text-sm">{entry.description}</p>
        <label className="block text-sm">{rejecting ? "Rejection reason" : "Review note (optional)"}
          <textarea aria-required={rejecting} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-border bg-background p-2" />
        </label>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-4">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant={rejecting ? "destructive" : "default"} disabled={rejecting && !note.trim()} onClick={() => onConfirm(note.trim())}>
          {rejecting ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}{title}
        </Button>
      </div>
    </section>
  </div>
}
