"use client"

import { useState } from "react"
import { Clock3, ListChecks, BarChart3 } from "lucide-react"
import { NoteInput } from "@/components/note-input"
import { EntriesLog } from "@/components/entries-log"
import { ManagerReport } from "@/components/manager-report"
import type { ParsedEntry, TimeEntry } from "@/lib/types"

type View = "log" | "report"

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function Page() {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [view, setView] = useState<View>("log")

  function addParsed(parsed: ParsedEntry[]) {
    setEntries((prev) => [
      ...parsed.map((p) => ({ ...p, id: makeId() })),
      ...prev,
    ])
  }

  function updateEntry(id: string, patch: Partial<TimeEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )
  }

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
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
          onClear={() => setEntries([])}
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
        this session · data is kept in memory only
      </footer>
    </main>
  )
}
