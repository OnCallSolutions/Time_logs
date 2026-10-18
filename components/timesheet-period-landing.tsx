"use client"

import { useEffect, useState } from "react"
import { Activity, CalendarClock, ChevronRight, Clock3, Pencil, RefreshCw } from "lucide-react"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string}

/** Gives each role a period archive before opening its raw timesheet records. */
export function TimesheetPeriodLanding({entries,onSelect,onLogTime,onRefresh,canCreate=false}:{entries:TimeEntry[];onSelect:(periodId:string)=>void;onLogTime?:()=>void;onRefresh?:()=>void;canCreate?:boolean}){
  const [periods,setPeriods]=useState<Period[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  const now=new Date()
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-")
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Timesheet periods could not be loaded.")
      setPeriods(Array.isArray(data.periods)?data.periods:[])
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Timesheet periods could not be loaded.")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[])
  const ordered=[...periods].sort((a,b)=>b.startDate.localeCompare(a.startDate))
  const active=ordered.find(period=>period.startDate<=today&&period.endDate>=today)
  const current=active?[active]:[]
  const upcoming=ordered.filter(period=>period.startDate>today)
  const archived=ordered.filter(period=>period.endDate<today)
  const periodEntries=(period:Period)=>entries.filter(entry=>entry.date>=period.startDate&&entry.date<=period.endDate)
  const dueLabel=(period:Period)=>new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(period.submissionDeadline))
  const openAll=()=>onSelect("all")
  return <section aria-label="Timesheet periods" className="flex min-h-0 w-full flex-col gap-3">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-3 py-2">
      <div><h2 className="text-sm font-semibold text-sky-950">Timesheet periods</h2><p className="text-xs text-slate-600">Choose a period to open its raw time entries and submission controls.</p></div>
      <div className="flex gap-1.5">{canCreate&&onLogTime&&<Button size="sm" onClick={onLogTime}><Pencil className="size-3.5"/>Log time</Button>}{onRefresh&&<Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw className="size-3.5"/>Refresh</Button>}</div>
    </header>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-1 pb-2 text-xs"><span>{entries.length} visible entries</span><span>{entries.reduce((sum,entry)=>sum+Number(entry.hours||0),0).toLocaleString(undefined,{maximumFractionDigits:2})} hours</span><span className="text-emerald-800">{entries.filter(entry=>entry.status==="approved").length} approved</span><span className="text-blue-800">{entries.filter(entry=>entry.status==="submitted").length} awaiting review</span><span className="text-orange-800">{entries.filter(entry=>entry.status==="draft").length} drafts</span></div>
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {loading?<p role="status" className="px-2 py-4 text-sm text-slate-600">Loading period archive…</p>:<div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
      <nav aria-label="Available timesheet periods" className="min-h-0 overflow-auto border-y border-sky-200 bg-sky-50/30 p-2">
        <button type="button" onClick={openAll} className="mb-2 flex w-full items-center justify-between rounded-md border-l-2 border-blue-500 bg-blue-50 px-2.5 py-2 text-left transition hover:bg-blue-100"><span><span className="block text-xs font-semibold text-blue-950">All saved periods</span><span className="block text-[10px] text-blue-800">Combined view · all matching entries</span></span><span className="text-xs tabular-nums text-blue-950">{entries.length}</span></button>
        {!periods.length?<p className="px-2 py-3 text-xs text-slate-600">No time periods are configured. Open all saved timesheets to view existing entries.</p>:<>
          {current.length>0&&<PeriodGroup title="Current period" periods={current} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {upcoming.length>0&&<PeriodGroup title="Upcoming periods" periods={upcoming} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {archived.length>0&&<PeriodGroup title="Archived periods" periods={archived} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {!current.length&&!upcoming.length&&!archived.length&&<p className="px-2 py-3 text-xs text-slate-600">No periods are available.</p>}
        </>}
      </nav>
      <section className="flex min-h-40 flex-col justify-center border-y border-emerald-200 bg-gradient-to-br from-emerald-50/60 via-white to-orange-50/60 p-4"><CalendarClock className="mb-2 size-5 text-emerald-700" aria-hidden="true"/><h3 className="text-sm font-semibold text-emerald-950">Select a period to open its timesheets</h3><p className="mt-1 max-w-xl text-sm text-slate-700">Each period opens a separate raw-entry view with its existing search, filters, sorting, grouping, editing, and submission actions. Archived records stay retrievable without mixing into the current period.</p></section>
    </div>}
  </section>
}

function PeriodGroup({title,periods,today,onSelect,dueLabel,periodEntries}:{title:string;periods:Period[];today:string;onSelect:(id:string)=>void;dueLabel:(period:Period)=>string;periodEntries:(period:Period)=>TimeEntry[]}){
  return <section className="mb-2"><h3 className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{title}</h3><div className="space-y-1">{periods.map(period=>{
    const rows=periodEntries(period)
    const hours=rows.reduce((sum,entry)=>sum+Number(entry.hours||0),0)
    const approved=rows.filter(entry=>entry.status==="approved").length
    const due=Date.parse(period.submissionDeadline)
    const tone=period.startDate<=today&&period.endDate>=today?"border-emerald-500 bg-emerald-50 hover:bg-emerald-100":period.startDate>today?"border-sky-400 bg-white hover:bg-sky-50":"border-orange-400 bg-white hover:bg-orange-50"
    return <button key={period.id} type="button" onClick={()=>onSelect(period.id)} className={`group flex w-full items-center justify-between gap-3 rounded-md border-l-2 px-2.5 py-2 text-left transition ${tone}`}>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-950">{period.name}</span><span className="block text-[10px] text-slate-600">{period.startDate} – {period.endDate}</span><span className={`mt-0.5 block text-[10px] ${due<Date.now()?"text-red-800":"text-slate-600"}`}><Clock3 className="mr-1 inline size-3"/>Submit by {dueLabel(period)}</span></span>
      <span className="shrink-0 text-right"><span className="block text-xs font-semibold tabular-nums text-slate-900">{rows.length} {rows.length===1?"entry":"entries"}</span><span className="block text-[10px] tabular-nums text-slate-600">{hours.toLocaleString(undefined,{maximumFractionDigits:2})}h · {approved} approved</span><ChevronRight className="ml-auto mt-1 size-3.5 text-slate-500 transition group-hover:translate-x-0.5"/></span>
    </button>
  })}</div></section>
}
