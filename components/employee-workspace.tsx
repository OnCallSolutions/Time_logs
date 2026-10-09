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
export function EmployeeWorkspace({ entries, selected, onSelect, contractor=false }: {
  entries: TimeEntry[]; selected: EntryStatus | "all"; onSelect: (status: EntryStatus | "all") => void; contractor?:boolean
}) {
  const options = [
    { status: "all", label: "All my entries", icon: ListChecks },
    { status: "draft", label: "Drafts", icon: ClipboardList },
    { status: "submitted", label: "Awaiting approval", icon: Send },
    { status: "rejected", label: "Needs correction", icon: XCircle },
    { status: "approved", label: "Approved", icon: CheckCircle2 },
  ] as const
  return <section aria-label={contractor?"Contractor workflow":"Personal workflow"} className="flex flex-wrap items-center gap-2">
    <h2 className="mr-2 text-sm font-semibold">{contractor?"Contractor submissions":"Internal staff time"}</h2>
    {contractor&&<dl className="flex w-full flex-wrap gap-5 border-b pb-3 text-sm"><div><dt className="text-muted-foreground">Submitted hours</dt><dd className="font-semibold">{entries.filter(entry=>entry.status==="submitted").reduce((total,entry)=>total+entry.hours,0)}</dd></div><div><dt className="text-muted-foreground">Approved hours</dt><dd className="font-semibold text-green-700">{entries.filter(entry=>entry.status==="approved").reduce((total,entry)=>total+entry.hours,0)}</dd></div><div><dt className="text-muted-foreground">Contract projects</dt><dd className="font-semibold">{new Set(entries.map(entry=>entry.project)).size}</dd></div></dl>}
    {options.map(({status,label,icon:Icon}) => <Button key={status} variant={selected === status ? "default" : "outline"} aria-pressed={selected === status} onClick={() => onSelect(status)}>
      <Icon className="size-4" aria-hidden="true" />{label}
      <span className="tabular-nums">{status === "all" ? entries.length : entries.filter(entry => entry.status === status).length}</span>
    </Button>)}
  </section>
}
