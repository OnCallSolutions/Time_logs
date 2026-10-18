"use client"

import { useEffect, useState } from "react"
import { Activity, CalendarClock, CheckCircle2, ChevronRight, Clock3, Pencil, RefreshCw } from "lucide-react"
import { apiPath } from "@/lib/paths"
import type { TimeEntry, UserRole } from "@/lib/types"
import { Button } from "@/components/ui/button"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string}

/** Gives each role a period archive before opening its raw timesheet records. */
export function TimesheetPeriodLanding({entries,onSelect,onLogTime,onRefresh,canCreate=false,personalReadiness=false,role}:{entries:TimeEntry[];onSelect:(periodId:string)=>void;onLogTime?:()=>void;onRefresh?:()=>void;canCreate?:boolean;personalReadiness?:boolean;role?:UserRole}){
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
  const featuredPeriod=active??upcoming[0]??archived[0]
  const featuredEntries=featuredPeriod?periodEntries(featuredPeriod):[]
  const previewEntries=[...featuredEntries].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,6)
  const featuredHours=featuredEntries.reduce((sum,entry)=>sum+Number(entry.hours||0),0)
  const featuredStatuses={draft:featuredEntries.filter(entry=>entry.status==="draft").length,submitted:featuredEntries.filter(entry=>entry.status==="submitted").length,approved:featuredEntries.filter(entry=>entry.status==="approved").length,rejected:featuredEntries.filter(entry=>entry.status==="rejected").length}
  const entriesWithoutDescription=featuredEntries.filter(entry=>!entry.description?.trim()).length
  const needsAction=featuredStatuses.draft+featuredStatuses.rejected
  const featuredPeople=new Set(featuredEntries.map(entry=>entry.contractor).filter(Boolean)).size
  const featuredProjects=new Set(featuredEntries.map(entry=>entry.project).filter(Boolean)).size
  const accountManagerView=role==="account_manager"||role==="admin"
  const projectPreview=[...featuredEntries.reduce((projects,entry)=>{
    const summary=projects.get(entry.project)??{hours:0,entries:0}
    summary.hours+=Number(entry.hours)||0;summary.entries+=1;projects.set(entry.project,summary);return projects
  },new Map<string,{hours:number;entries:number}>())].sort((a,b)=>b[1].hours-a[1].hours||a[0].localeCompare(b[0])).slice(0,4)
  const managerPreview=[...featuredEntries.reduce((managers,entry)=>{
    const name=entry.reviewManagerName||entry.reviewManagerEmail||"Manager not assigned"
    managers.set(name,(managers.get(name)??0)+1);return managers
  },new Map<string,number>())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4)
  const openAll=()=>onSelect("all")
  return <section aria-label="Timesheet periods" className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-3 py-2">
      <div><h2 className="text-sm font-semibold text-sky-950">Timesheet periods</h2><p className="text-xs text-slate-600">Choose a period to open its raw time entries and submission controls.</p></div>
      <div className="flex gap-1.5">{canCreate&&onLogTime&&<Button size="sm" onClick={onLogTime}><Pencil className="size-3.5"/>Log time</Button>}{onRefresh&&<Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw className="size-3.5"/>Refresh</Button>}</div>
    </header>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-1 pb-2 text-xs"><span>{entries.length} visible entries</span><span>{entries.reduce((sum,entry)=>sum+Number(entry.hours||0),0).toLocaleString(undefined,{maximumFractionDigits:2})} hours</span><span className="text-emerald-800">{entries.filter(entry=>entry.status==="approved").length} approved</span><span className="text-blue-800">{entries.filter(entry=>entry.status==="submitted").length} awaiting review</span><span className="text-orange-800">{entries.filter(entry=>entry.status==="draft").length} drafts</span></div>
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {loading?<p role="status" className="px-2 py-4 text-sm text-slate-600">Loading period archive…</p>:<div className="grid min-h-0 flex-1 grid-rows-[minmax(8rem,0.4fr)_minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:grid-rows-1">
      <nav aria-label="Available timesheet periods" className="min-h-0 max-h-[calc(100dvh-14rem)] overflow-auto border border-sky-200 bg-sky-50/30 p-2 lg:max-h-none">
        <button type="button" onClick={openAll} className="mb-2 flex w-full items-center justify-between rounded-md border-l-2 border-blue-500 bg-blue-50 px-2.5 py-2 text-left transition hover:bg-blue-100"><span><span className="block text-xs font-semibold text-blue-950">All saved periods</span><span className="block text-[10px] text-blue-800">Combined view · all matching entries</span></span><span className="text-xs tabular-nums text-blue-950">{entries.length}</span></button>
        {!periods.length?<p className="px-2 py-3 text-xs text-slate-600">No time periods are configured. Open all saved timesheets to view existing entries.</p>:<>
          {current.length>0&&<PeriodGroup title="Current period" periods={current} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {upcoming.length>0&&<PeriodGroup title="Upcoming periods" periods={upcoming} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {archived.length>0&&<PeriodGroup title="Archived periods" periods={archived} today={today} onSelect={onSelect} dueLabel={dueLabel} periodEntries={periodEntries}/>}
          {!current.length&&!upcoming.length&&!archived.length&&<p className="px-2 py-3 text-xs text-slate-600">No periods are available.</p>}
        </>}
      </nav>
      <section aria-label="Period overview" className="flex min-h-0 min-w-0 flex-col overflow-y-auto border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-orange-50/60 p-2.5 sm:p-3">
        {featuredPeriod?<>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-200 pb-3"><div className="flex min-w-0 items-start gap-2"><CalendarClock className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true"/><div className="min-w-0"><p className="text-[10px] font-semibold uppercase text-emerald-800">{active?"Current period":upcoming.length?"Next period":"Most recent period"}</p><h3 className="truncate text-base font-semibold text-emerald-950">{featuredPeriod.name}</h3><p className="text-xs text-slate-600">{featuredPeriod.startDate} – {featuredPeriod.endDate}</p></div></div><Button size="sm" onClick={()=>onSelect(featuredPeriod.id)}>Open timesheets<ChevronRight className="size-3.5"/></Button></header>
          <div className={`grid grid-cols-2 gap-2 py-3 sm:grid-cols-3 ${personalReadiness?"lg:grid-cols-5":"lg:grid-cols-6"}`}>
            <OverviewStat label="Entries recorded" value={featuredEntries.length} tone="blue"/>
            <OverviewStat label="Hours recorded" value={`${featuredHours.toLocaleString(undefined,{maximumFractionDigits:2})}h`} tone="green"/>
            <OverviewStat label={personalReadiness?"Projects":"People"} value={personalReadiness?featuredProjects:featuredPeople} tone="sky"/>
            {!personalReadiness&&<OverviewStat label="Projects" value={featuredProjects} tone="orange"/>}
            <OverviewStat label="Awaiting review" value={featuredStatuses.submitted} tone="blue"/>
            <OverviewStat label="Approved" value={featuredStatuses.approved} tone="green"/>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-slate-200 py-2 text-xs"><span className="text-orange-900">{featuredStatuses.draft} drafts</span><span className="text-red-800">{featuredStatuses.rejected} returned for correction</span><span className={Date.parse(featuredPeriod.submissionDeadline)<Date.now()&&featuredStatuses.submitted+featuredStatuses.draft>0?"text-red-800":"text-slate-700"}><Clock3 className="mr-1 inline size-3.5"/>Submit by {dueLabel(featuredPeriod)}</span></div>
          {personalReadiness&&active?.id===featuredPeriod.id&&<section aria-label="Submission readiness" className="mt-3 border border-orange-200 bg-orange-50/50 p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-xs font-semibold text-orange-950">Current-period submission readiness</h4><p className="text-[10px] text-slate-700">Progress reflects saved entries only; no expected hours or workdays are assumed.</p></div><Button size="sm" variant="outline" className="h-7 border-orange-300 bg-white px-2 text-xs text-orange-950 hover:bg-orange-100" onClick={()=>onSelect(featuredPeriod.id)}><CheckCircle2 className="size-3.5"/>Review timesheets</Button></div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <ReadinessStat label="Saved entries" value={featuredEntries.length} tone="blue"/>
              <ReadinessStat label="Drafts to submit" value={featuredStatuses.draft} tone={featuredStatuses.draft?"orange":"green"}/>
              <ReadinessStat label="Returned to correct" value={featuredStatuses.rejected} tone={featuredStatuses.rejected?"red":"green"}/>
              <ReadinessStat label="No description" value={entriesWithoutDescription} tone={entriesWithoutDescription?"orange":"green"}/>
            </div>
            <p role="status" className={`mt-2 text-[11px] ${Date.parse(featuredPeriod.submissionDeadline)<=Date.now()&&needsAction?"text-red-800":"text-slate-700"}`}>{Date.parse(featuredPeriod.submissionDeadline)<=Date.now()&&needsAction?"The submission deadline has passed. Contact your manager about next steps.":needsAction?`${needsAction} entries need your attention before submission.`:featuredEntries.length?"No drafts or returned entries are waiting on you.":"No entries have been recorded in this period yet."}{entriesWithoutDescription>0?` ${entriesWithoutDescription} ${entriesWithoutDescription===1?"entry has":"entries have"} no description; check whether details should be added.`:""}</p>
          </section>}
          <section aria-label="Current timesheet preview" className="mt-3 min-w-0 border-l-2 border-sky-400 bg-white/80">
            <header className="flex items-center justify-between gap-2 border-b border-sky-100 px-2.5 py-1.5"><h4 className="text-xs font-semibold text-sky-950">Recent work · preview</h4><span className="text-[10px] text-slate-600">Latest {previewEntries.length} of {featuredEntries.length} · Display only</span></header>
            {previewEntries.length?<ul className="divide-y divide-slate-100">{previewEntries.map(entry=><li key={entry.id} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 text-xs">
              <time dateTime={entry.date} className="text-[10px] tabular-nums text-slate-600">{entry.date}</time>
              <span className="min-w-0"><span className="block truncate font-medium text-slate-900" title={entry.project}>{entry.project}</span><span className="block truncate text-[10px] text-slate-600" title={entry.description}>{entry.description||"No description"}</span></span>
              <span className="flex items-center gap-2"><span className="tabular-nums text-slate-700">{Number(entry.hours).toLocaleString(undefined,{maximumFractionDigits:2})}h</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] capitalize ${entry.status==="approved"?"bg-emerald-100 text-emerald-800":entry.status==="submitted"?"bg-sky-100 text-sky-800":entry.status==="rejected"?"bg-red-100 text-red-800":"bg-orange-100 text-orange-900"}`}>{entry.status}</span></span>
            </li>)}</ul>:<p className="px-2.5 py-2 text-xs text-slate-600">No time entries in this period yet.</p>}
          </section>
          {accountManagerView&&<section aria-label="Project and manager preview" className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0 border border-emerald-200 bg-white/80">
              <h4 className="border-b border-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-950">Projects in this period</h4>
              {projectPreview.length?<ul className="divide-y divide-slate-100">{projectPreview.map(([project,summary])=><li key={project} className="flex min-w-0 items-center justify-between gap-2 px-2 py-1 text-[11px]"><span className="min-w-0 truncate font-medium" title={project}>{project}</span><span className="shrink-0 tabular-nums text-slate-700">{summary.entries} entries · {summary.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h</span></li>)}</ul>:<p className="px-2 py-2 text-[11px] text-slate-600">No projects have time recorded.</p>}
            </div>
            <div className="min-w-0 border border-blue-200 bg-white/80">
              <h4 className="border-b border-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-950">Review managers</h4>
              {managerPreview.length?<ul className="divide-y divide-slate-100">{managerPreview.map(([manager,count])=><li key={manager} className="flex min-w-0 items-center justify-between gap-2 px-2 py-1 text-[11px]"><span className="min-w-0 truncate font-medium" title={manager}>{manager}</span><span className="shrink-0 tabular-nums text-slate-700">{count} {count===1?"entry":"entries"}</span></li>)}</ul>:<p className="px-2 py-2 text-[11px] text-slate-600">No manager assignments recorded.</p>}
            </div>
          </section>}
          <p className="mt-auto pt-3 text-xs text-slate-600"><CheckCircle2 className="mr-1 inline size-3.5 text-emerald-700"/>Choose any period on the left to open its searchable raw timesheets and approval controls. Archived periods remain read-only.</p>
        </>:<div className="flex min-h-40 flex-1 flex-col justify-center"><CalendarClock className="mb-2 size-5 text-emerald-700" aria-hidden="true"/><h3 className="text-sm font-semibold text-emerald-950">No timesheet periods configured</h3><p className="mt-1 max-w-xl text-sm text-slate-700">Open all saved timesheets to review existing records, or ask an account manager to configure the next work period.</p><Button className="mt-3 w-fit" size="sm" variant="outline" onClick={openAll}>Open all saved timesheets<ChevronRight className="size-3.5"/></Button></div>}
      </section>
    </div>}
  </section>
}

function OverviewStat({label,value,tone}:{label:string;value:string|number;tone:"blue"|"green"|"sky"|"orange"}){
  const colors={blue:"border-blue-200 bg-blue-50 text-blue-950",green:"border-emerald-200 bg-emerald-50 text-emerald-950",sky:"border-sky-200 bg-sky-50 text-sky-950",orange:"border-orange-200 bg-orange-50 text-orange-950"}
  return <div className={`min-w-0 border-l-2 px-2 py-1.5 ${colors[tone]}`}><p className="truncate text-[10px]">{label}</p><p className="truncate text-sm font-semibold tabular-nums">{value}</p></div>
}

function ReadinessStat({label,value,tone}:{label:string;value:number;tone:"blue"|"green"|"orange"|"red"}){
  const colors={blue:"border-blue-200 bg-blue-50 text-blue-950",green:"border-emerald-200 bg-emerald-50 text-emerald-950",orange:"border-orange-200 bg-orange-50 text-orange-950",red:"border-red-200 bg-red-50 text-red-950"}
  return <div className={`flex min-w-0 items-center justify-between gap-2 border-l-2 px-2 py-1 ${colors[tone]}`}><span className="truncate text-[10px]">{label}</span><strong className="text-xs tabular-nums">{value}</strong></div>
}

function PeriodGroup({title,periods,today,onSelect,dueLabel,periodEntries}:{title:string;periods:Period[];today:string;onSelect:(id:string)=>void;dueLabel:(period:Period)=>string;periodEntries:(period:Period)=>TimeEntry[]}){
  return <section className="mb-2"><h3 className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{title}</h3><div className="space-y-1">{periods.map(period=>{
    const rows=periodEntries(period)
    const hours=rows.reduce((sum,entry)=>sum+Number(entry.hours||0),0)
    const approved=rows.filter(entry=>entry.status==="approved").length
    const submittedAt=rows.map(entry=>entry.submittedAt).filter((value):value is string=>!!value).sort().at(-1)
    const due=Date.parse(period.submissionDeadline)
    const tone=period.startDate<=today&&period.endDate>=today?"border-emerald-600 bg-emerald-50 hover:bg-emerald-100":period.startDate>today?"border-sky-500 bg-white hover:bg-sky-50":"border-orange-500 bg-white hover:bg-orange-50"
    return <button key={period.id} type="button" onClick={()=>onSelect(period.id)} className={`group flex w-full items-center justify-between gap-3 rounded-sm border border-l-4 px-2.5 py-2 text-left shadow-sm transition ${tone}`}>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-950">{period.name}</span><span className="block text-[10px] text-slate-600">{period.startDate} – {period.endDate}</span><span className={`mt-0.5 block text-[10px] ${period.endDate<today?"text-slate-600":due<Date.now()?"text-red-800":"text-slate-600"}`}><Clock3 className="mr-1 inline size-3"/>{period.endDate<today?submittedAt?`Submitted on ${new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric"}).format(new Date(submittedAt))}`:"No submission recorded":"Submit by "+dueLabel(period)}</span></span>
      <span className="shrink-0 text-right"><span className="block text-xs font-semibold tabular-nums text-slate-900">{rows.length} {rows.length===1?"entry":"entries"}</span><span className="block text-[10px] tabular-nums text-slate-600">{hours.toLocaleString(undefined,{maximumFractionDigits:2})}h · {approved} approved</span><ChevronRight className="ml-auto mt-1 size-3.5 text-slate-500 transition group-hover:translate-x-0.5"/></span>
    </button>
  })}</div></section>
}
