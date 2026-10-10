"use client"

/**
 * Provides the note input surface that submits free-form text for AI parsing.
 *
 * The input lets users paste informal notes, keyboard-submit them, or load a
 * sample. It owns transient parsing state and delegates persisted entry handling
 * to its parent through the onParsed callback.
 */
import { useState } from "react"
import { Loader2, Sparkles, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry } from "@/lib/types"


/**
 * Captures messy time notes and sends them to the parser API.
 *
 * This component does not save entries directly. It only asks the parser API to
 * turn free-form text into structured entries, then hands those entries to the
 * parent so the main workspace can persist them.
 *
 * @param props - Component props.
 * @param props.onParsed - Callback invoked with parsed entries after extraction.
 * @returns The note entry form and parse controls.
 */
export function NoteInput({
  onParsed,
  previewOnly=false,
}: {
  onParsed: (entries: ParsedEntry[]) => void | Promise<void>
  previewOnly?:boolean
}) {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Loads synthetic examples scoped by the authenticated server identity.
   * @returns Promise<void> after replacing notes or displaying a safe error.
   */
  async function loadSample(){
    setLoading(true);setError(null)
    try{const response=await fetch(apiPath("/api/samples"),{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error);setNotes(data.notes)}
    catch(error){setError(error instanceof Error?error.message:"Samples unavailable.")}finally{setLoading(false)}
  }

  /**
   * Parses the current notes and forwards any extracted entries to the parent.
   *
   * The handler blocks duplicate submissions while loading, displays parser errors
   * inline, and clears the text area only after the parent callback accepts the
   * extracted entries.
   *
   * @returns A promise that resolves after parsing, saving, or error handling.
   */
  async function handleParse() {
    if (!notes.trim() || loading || previewOnly) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiPath("/api/parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.")
      const entries: ParsedEntry[] = data.entries ?? []
      if (entries.length === 0) {
        setError("No time entries were found in those notes.")
      } else {
        await onParsed(entries)
        setNotes("")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse notes.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="border-y border-border bg-card px-1 py-5 sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-none">Log time notes</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste anything — messy notes, multiple people, any format.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSample}
          help="Load synthetic sample notes scoped to your role. Samples are not proof of actual work."
          disabled={loading}
        >
          <WandSparkles className="size-3.5" aria-hidden="true" />
          Try a sample
        </Button>
      </div>

      <label htmlFor="notes" className="sr-only">
        Time worked notes
      </label>
      <textarea
        id="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault()
            handleParse()
          }
        }}
        rows={6}
        placeholder="e.g. Maria worked Mon 9-5 on Acme, Tue a half day. Deepak did two full days on the Northwind API…"
        className="max-h-[50dvh] min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <>
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.65rem]">
                ⌘/Ctrl + Enter
              </kbd>{" "}
              to extract
            </>
          )}
        </p>
        {!previewOnly&&<Button onClick={handleParse} disabled={loading || !notes.trim()} size="lg">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Extracting…
            </>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden="true" />
              Extract entries
            </>
          )}
        </Button>}
      </div>
    </section>
  )
}
