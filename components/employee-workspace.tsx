/**
 * Provides personal workflow shortcuts for employees and baseline users.
 * Status buttons filter only the entries already authorized by the server.
 * This component never fetches team records or exposes administrative actions.
 */
"use client"
import { CheckCircle2, ClipboardList, ListChecks, Send, XCircle } from "lucide-react"
import type { EntryStatus, TimeEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"

/**
 * Renders status shortcuts with live counts for personal time entries.
 * @param props.entries - Server-authorized personal records.
 * @param props.selected - Currently selected personal status filter.
 * @param props.onSelect - Callback that selects a status without changing records.
 * @returns JSX.Element with employee workflow controls.
 */
export function EmployeeWorkspace({ entries, selected, onSelect }: {
  entries: TimeEntry[]; selected: EntryStatus | "all"; onSelect: (status: EntryStatus | "all") => void
}) {
  const options = [
    { status: "all", label: "All my entries", icon: ListChecks },
    { status: "draft", label: "Drafts", icon: ClipboardList },
    { status: "submitted", label: "Awaiting approval", icon: Send },
    { status: "rejected", label: "Needs correction", icon: XCircle },
    { status: "approved", label: "Approved", icon: CheckCircle2 },
  ] as const
  return <section aria-label="Personal workflow" className="flex flex-wrap gap-2">
    {options.map(({status,label,icon:Icon}) => <Button key={status} className="feature-control" data-feature={status} variant="outline" aria-pressed={selected === status} onClick={() => onSelect(status)}>
      <Icon className="size-4" aria-hidden="true" />{label}
      <span className="tabular-nums">{status === "all" ? entries.length : entries.filter(entry => entry.status === status).length}</span>
    </Button>)}
  </section>
}
