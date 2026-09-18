"use client"

import { useState } from "react"
import { Loader2, Sparkles, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry } from "@/lib/types"

const SAMPLE = `Maria Alvarez: Mon worked 9-5 on the Acme website redesign, Tue only a half day (sick).
Deepak logged full days Wednesday and Thursday building the payments API for Northwind.
Sarah — Friday, roughly 6 hrs, QA testing + a client call for the Acme project.
Tom did 3 hours of on-call support yesterday, nothing else this week.`

export function NoteInput({
  onParsed,
}: {
  onParsed: (entries: ParsedEntry[]) => void | Promise<void>
}) {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleParse() {
    if (!notes.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiPath("/parse"), {
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
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
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
          onClick={() => setNotes(SAMPLE)}
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
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
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
        <Button onClick={handleParse} disabled={loading || !notes.trim()} size="lg">
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
        </Button>
      </div>
    </section>
  )
}
