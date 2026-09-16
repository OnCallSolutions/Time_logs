"use client"

import { useEffect, useState } from "react"
import { Clock3, ListChecks, BarChart3 } from "lucide-react"
import { NoteInput } from "@/components/note-input"
import { EntriesLog } from "@/components/entries-log"
import { ManagerReport } from "@/components/manager-report"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry, TimeEntry } from "@/lib/types"

type View = "log" | "report"

export default function Page() {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [view, setView] = useState<View>("log")
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadEntries() {
      try {
        const res = await fetch(apiPath("/api/entries"), { cache: "no-store" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to load entries.")
        if (active) setEntries(data.entries ?? [])
      } catch (err) {
        if (active) {
          setSyncError(
            err instanceof Error ? err.message : "Failed to load entries.",
          )
        }
      } finally {
        if (active) setLoadingEntries(false)
      }
    }

    loadEntries()

    return () => {
      active = false
    }
  }, [])

  async function addParsed(parsed: ParsedEntry[]) {
    const res = await fetch(apiPath("/api/entries"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: parsed }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Failed to save entries.")
    setEntries((prev) => [...(data.entries ?? []), ...prev])
    setSyncError(null)
  }

  function updateEntry(id: string, patch: Partial<TimeEntry>) {
    const previous = entries
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )

    fetch(apiPath(`/api/entries/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to update entry.")
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? data.entry : e)),
        )
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to update entry.",
        )
      })
  }

  function deleteEntry(id: string) {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))

    fetch(apiPath(`/api/entries/${id}`), { method: "DELETE" })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to delete entry.")
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to delete entry.",
        )
      })
  }

  function clearEntries() {
    const previous = entries
    setEntries([])

    fetch(apiPath("/api/entries"), { method: "DELETE" })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to clear entries.")
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to clear entries.",
        )
      })
  }

  const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)

  const tabs: { key: View; label: string; icon: typeof ListChecks }[] = [
    { key: "log", label: "Entries", icon: ListChecks },
    { key: "report", label: "Manager report", icon: BarChart3 },
  ]

  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-6 px-4 py-8 md:py-12">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-primary">
          <Clock3 className="size-5" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-widest">
            Timesheet
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Contractor hours, from messy notes to a manager report
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Paste time-worked notes in any format. AI extracts structured entries you
          can review and edit, then rolls them into a clean report of hours per
          contractor.
        </p>
      </header>

      <NoteInput onParsed={addParsed} />

      {(loadingEntries || syncError) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            syncError
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
          role={syncError ? "alert" : "status"}
        >
          {syncError ?? "Loading saved entries..."}
        </div>
      )}

      {/* View switch */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              view === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {key === "log" && entries.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${
                  view === key
                    ? "bg-primary-foreground/20"
                    : "bg-muted-foreground/15"
                }`}
              >
                {entries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "log" ? (
        <EntriesLog
          entries={entries}
          onUpdate={updateEntry}
          onDelete={deleteEntry}
          onClear={clearEntries}
        />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <p className="text-sm font-medium">Nothing to report yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add some entries first and the manager report will build itself.
          </p>
        </div>
      ) : (
        <ManagerReport entries={entries} />
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        {entries.length} entries ·{" "}
        {totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h logged
        this session · data is saved to Neon
      </footer>
    </main>
  )
}
