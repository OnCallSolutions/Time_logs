"use client"

import { useEffect, useState } from "react"
import { CalendarClock, ChevronRight, CircleHelp, Eye, Plus, Save } from "lucide-react"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import { DataExportMenu } from "@/components/data-export-menu"
import { apiPath } from "@/lib/paths"
import type { TimesheetPeriod, TimesheetPeriodAuditRecord, TimesheetPeriodScheduleIssue } from "@/lib/db"

/** Admin interface for dated work periods, reminder lead time, and manager grace. */
export function SubmissionDeadlineSettings({defaultOpen=false}:{defaultOpen?:boolean}) {
  const [periods,setPeriods]=useState<TimesheetPeriod[]>([])
  const [scheduleIssues,setScheduleIssues]=useState<TimesheetPeriodScheduleIssue[]>([])
  const [name,setName]=useState("")
  const [nameEdited,setNameEdited]=useState(false)
  const [startDate,setStartDate]=useState("")
  const [endDate,setEndDate]=useState("")
  const [deadline,setDeadline]=useState("")
  const [managerDeadline,setManagerDeadline]=useState("")
  const [accountDeadline,setAccountDeadline]=useState("")
  const [resolutionDeadline,setResolutionDeadline]=useState("")
  const [timezone,setTimezone]=useState("America/New_York")
  const [managerGraceDays,setManagerGraceDays]=useState(2)
  const [reminderDays,setReminderDays]=useState(3)
  const [editingId,setEditingId]=useState<string|null>(null)
  const [formOpen,setFormOpen]=useState(false)
  const [reason,setReason]=useState("")
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [confirming,setConfirming]=useState(false)
  const [error,setError]=useState("")
  const [saved,setSaved]=useState("")
  const [periodSearch,setPeriodSearch]=useState("")
  const [periodStateFilter,setPeriodStateFilter]=useState("all")
  const [selectedArchived,setSelectedArchived]=useState<TimesheetPeriod|null>(null)
  const [periodHistory,setPeriodHistory]=useState<TimesheetPeriodAuditRecord[]>([])
  const [historyLoading,setHistoryLoading]=useState(false)
  const [historyError,setHistoryError]=useState("")
  const [aboutOpen,setAboutOpen]=useState(false)
  const now=new Date()
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`
  const visiblePeriods=periods.filter(period=>{
    const current=period.startDate<=today&&period.endDate>=today
    const upcoming=period.startDate>today
    const matchesState=periodStateFilter==="all"||periodStateFilter==="current"&&current||periodStateFilter==="upcoming"&&upcoming||periodStateFilter==="archived"&&period.endDate<today
    return matchesState&&(!periodSearch.trim()||`${period.name} ${period.startDate} ${period.endDate}`.toLowerCase().includes(periodSearch.trim().toLowerCase()))
  })
  const archivedHistory=selectedArchived&&!periodHistory.some(event=>event.action==="timesheet_period_created")
    ?[...periodHistory,{actorEmail:selectedArchived.createdBy,action:"timesheet_period_created" as const,occurredAt:selectedArchived.createdAt,reason:null}].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))
    :periodHistory

  function dateInput(date:Date,hour=17):string{
    const value=new Date(date);value.setUTCHours(hour,0,0,0)
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,"0")}-${String(value.getUTCDate()).padStart(2,"0")}T${String(value.getUTCHours()).padStart(2,"0")}:${String(value.getUTCMinutes()).padStart(2,"0")}`
  }

  function dateTimeInZone(iso:string,zone=timezone):string{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso))
    const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??"00"
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
  }

  function dateTimeToIso(value:string,zone=timezone):string{
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
    if(!match)throw new Error("Enter a complete deadline date and time.")
    const [,year,month,day,hour,minute]=match.map(Number)
    const desired=Date.UTC(year,month-1,day,hour,minute)
    let instant=desired
    for(let attempt=0;attempt<3;attempt++){
      const [localDate,localTime]=dateTimeInZone(new Date(instant).toISOString(),zone).split("T")
      const [localYear,localMonth,localDay]=localDate.split("-").map(Number)
      const [localHour,localMinute]=localTime.split(":").map(Number)
      instant+=desired-Date.UTC(localYear,localMonth-1,localDay,localHour,localMinute)
    }
    if(dateTimeInZone(new Date(instant).toISOString(),zone)!==value)throw new Error("That local time does not exist in the selected timezone. Choose another time.")
    return new Date(instant).toISOString()
  }

  function defaultDeadlines(endDate:string){
    if(!endDate)return {worker:"",manager:"",accounts:"",issues:""}
    const [year,month,day]=endDate.split("-").map(Number)
    const end=new Date(Date.UTC(year,month-1,day))
    const daysUntilNextMonday=(8-end.getUTCDay())%7||7
    const worker=new Date(end);worker.setUTCDate(worker.getUTCDate()+daysUntilNextMonday)
    const manager=new Date(worker);manager.setUTCDate(manager.getUTCDate()+2)
    const accounts=new Date(worker);accounts.setUTCDate(accounts.getUTCDate()+3)
    const issues=new Date(worker);issues.setUTCDate(issues.getUTCDate()+4)
    return {worker:dateInput(worker),manager:dateInput(manager),accounts:dateInput(accounts),issues:dateInput(issues,12)}
  }

  function changePeriodEnd(value:string){
    setEndDate(value)
    const deadlines=defaultDeadlines(value)
    setDeadline(deadlines.worker);setManagerDeadline(deadlines.manager);setAccountDeadline(deadlines.accounts);setResolutionDeadline(deadlines.issues)
  }

  async function loadPeriods(signal?:AbortSignal) {
    const response=await fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error??"Could not load timesheet periods.")
    setPeriods(data.periods??[]);setScheduleIssues(data.scheduleIssues??[])
  }
  async function inspectArchivedPeriod(period:TimesheetPeriod){
    setSelectedArchived(period);setPeriodHistory([]);setHistoryError("");setHistoryLoading(true)
    try{
      const response=await fetch(apiPath(`/api/timesheet-periods/${encodeURIComponent(period.id)}/history`),{cache:"no-store"})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not load period history.")
      setPeriodHistory(data.history??[])
    }catch(cause){setHistoryError(cause instanceof Error?cause.message:"Could not load period history.")}
    finally{setHistoryLoading(false)}
  }
  useEffect(()=>{
    const controller=new AbortController()
    loadPeriods(controller.signal).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load timesheet periods.")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[])

  async function savePeriod() {
    if(!name.trim()||!startDate||!endDate||!deadline||(editingId&&!reason.trim()))return
    setSaving(true);setError("");setSaved("")
    try{
      const payload={name:name.trim(),startDate,endDate,submissionDeadline:dateTimeToIso(deadline),managerSubmissionDeadline:managerDeadline?dateTimeToIso(managerDeadline):undefined,accountApprovalDeadline:accountDeadline?dateTimeToIso(accountDeadline):undefined,exceptionResolutionDeadline:resolutionDeadline?dateTimeToIso(resolutionDeadline):undefined,timezone,managerGraceDays,reminderDays}
      const response=await fetch(apiPath("/api/timesheet-periods"),{method:editingId?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(editingId?{id:editingId,...payload,reason:reason.trim()}:payload)})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not save timesheet period.")
      const savedPeriod=data.period as TimesheetPeriod
      const savedName=savedPeriod.name
      setPeriods(current=>editingId?current.map(period=>period.id===savedPeriod.id?savedPeriod:period):[...current,savedPeriod].sort((a,b)=>b.startDate.localeCompare(a.startDate)))
      resetForm();setSaved(`${savedName} was ${editingId?"updated":"configured"}.`);setConfirming(false)
      try{await loadPeriods()}catch{setError(`${savedName} was saved, but the period list could not refresh. Close and reopen settings to verify it before retrying.`)}
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save timesheet period.")}
    finally{setSaving(false)}
  }

  function resetForm() {
    const start=new Date();start.setUTCHours(12,0,0,0);start.setUTCDate(start.getUTCDate()+((6-start.getUTCDay()+7)%7||7))
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6)
    const dateText=(date:Date)=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`
    const startText=dateText(start),endDate=dateText(end)
    const deadlines=defaultDeadlines(endDate)
    setFormOpen(false);setEditingId(null);setName(startText+" - "+endDate);setNameEdited(false);setStartDate(startText);setEndDate(endDate);setDeadline(deadlines.worker);setManagerDeadline(deadlines.manager);setAccountDeadline(deadlines.accounts);setResolutionDeadline(deadlines.issues);setTimezone("America/New_York");setManagerGraceDays(2);setReminderDays(3);setReason("");setError("")
  }

  function localInput(value:string|undefined,fallbackDays:number,fallbackHour=17){
    if(value)return dateTimeInZone(value)
    const [datePart]=deadline.split("T")
    const [year,month,day]=datePart.split("-").map(Number)
    const date=new Date(Date.UTC(year,month-1,day+fallbackDays,fallbackHour))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}T${String(date.getUTCHours()).padStart(2,"0")}:00`
  }

  function changeWorkerDeadline(value:string){
    setDeadline(value)
    if(!value)return
    const base=dateTimeToIso(value)
    const shifted=(days:number,hour=Number(value.slice(11,13)))=>{const date=new Date(base);date.setUTCDate(date.getUTCDate()+days);const parts=dateTimeInZone(date.toISOString()).split("T");return `${parts[0]}T${String(hour).padStart(2,"0")}:00`}
    setManagerDeadline(shifted(2));setAccountDeadline(shifted(3));setResolutionDeadline(shifted(4,12))
  }

  function editPeriod(period:TimesheetPeriod) {
    if(period.endDate<today){setError("Past periods are archived and cannot be edited.");return}
    setEditingId(period.id);setName(period.name);setStartDate(period.startDate);setEndDate(period.endDate)
    const periodTimezone=period.timezone||"America/New_York"
    setTimezone(periodTimezone);setNameEdited(true)
    setDeadline(dateTimeInZone(period.submissionDeadline,periodTimezone))
    setManagerDeadline(period.managerSubmissionDeadline?dateTimeInZone(period.managerSubmissionDeadline,periodTimezone):"");setAccountDeadline(period.accountApprovalDeadline?dateTimeInZone(period.accountApprovalDeadline,periodTimezone):"");setResolutionDeadline(period.exceptionResolutionDeadline?dateTimeInZone(period.exceptionResolutionDeadline,periodTimezone):"")
    setManagerGraceDays(period.managerGraceDays);setReminderDays(period.reminderDays);setReason("");setError("");setFormOpen(true)
  }

  return <><details open={defaultOpen} className="group flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-red-200 bg-red-50/60">
    <summary className="flex shrink-0 cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 [&::-webkit-details-marker]:hidden">
      <CalendarClock className="size-4 shrink-0 text-red-700"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-red-950">Configured periods</span><span className="block text-[11px] text-red-900">{periods.length} periods</span></span>
      <ChevronRight className="size-4 shrink-0 text-red-800 transition-transform group-open:rotate-90" aria-hidden="true"/>
    </summary>
    <section aria-label="Timesheet submission periods" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border-t border-red-200 px-3 py-2">
    {scheduleIssues.length>0&&<section aria-label="Unresolved period schedule issues" className="shrink-0 border border-red-300 bg-red-50 px-3 py-2"><h3 className="text-xs font-semibold text-red-900">Schedule needs attention · {scheduleIssues.length}</h3><ul className="mt-1 space-y-1 text-xs text-red-900">{scheduleIssues.map(issue=><li key={issue.id}>{issue.message}</li>)}</ul></section>}
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2"><Button variant="outline" size="icon" title="About timesheet periods" aria-label="About timesheet periods" onClick={()=>setAboutOpen(true)}><CircleHelp className="size-4"/></Button><DataExportMenu title="Timesheet period settings" filename="timesheet-periods" rows={visiblePeriods.map(period=>({id:period.id,name:period.name,startDate:period.startDate,endDate:period.endDate,timezone:period.timezone??"America/New_York",employeeDeadline:period.submissionDeadline,managerDeadline:period.managerSubmissionDeadline??"",accountApprovalDeadline:period.accountApprovalDeadline??"",exceptionResolutionDeadline:period.exceptionResolutionDeadline??"",managerGraceDays:period.managerGraceDays,reminderDays:period.reminderDays,state:period.endDate<today?"archived":period.startDate>today?"upcoming":"current"}))} summary={{periods:visiblePeriods.length,state:periodStateFilter,search:periodSearch||"None"}}/><Button size="sm" title="Add a non-overlapping work period" onClick={()=>{resetForm();setFormOpen(true)}}><Plus className="size-4"/>Add period</Button></div>
    {loading?<p role="status" className="shrink-0 text-xs text-slate-600">Loading periods...</p>:periods.length===0?<p className="shrink-0 text-xs text-slate-700">No periods configured.</p>:<><div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]"><label className="sr-only" htmlFor="period-settings-search">Search configured periods</label><input id="period-settings-search" type="search" value={periodSearch} onChange={event=>setPeriodSearch(event.target.value)} placeholder="Search period name or dates" className="h-8 min-w-0 border border-slate-300 bg-white px-2 text-xs"/><label className="sr-only" htmlFor="period-settings-filter">Filter periods by state</label><select id="period-settings-filter" value={periodStateFilter} onChange={event=>setPeriodStateFilter(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-xs"><option value="all">All period states</option><option value="current">Current</option><option value="upcoming">Upcoming</option><option value="archived">Archived</option></select></div><div className="min-h-0 min-w-0 flex-1 overflow-auto border border-red-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-red-100 text-red-950"><tr><th className="p-2">Period</th><th className="p-2">Work dates</th><th className="p-2">Worker deadline</th><th className="p-2">Manager grace</th><th className="p-2">Reminder</th><th className="w-16 p-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{visiblePeriods.map(period=>{const archived=period.endDate<today;return <tr key={period.id} className="border-t border-red-100"><td className="p-2 font-medium">{period.name}{archived&&<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Archived</span>}</td><td className="p-2">{period.startDate} - {period.endDate}</td><td className="p-2">{new Date(period.submissionDeadline).toLocaleString(undefined,{timeZone:period.timezone||"America/New_York"})}</td><td className="p-2">{period.managerGraceDays} days</td><td className="p-2">{period.reminderDays} days</td><td className="p-2">{archived?<Button size="icon" variant="outline" aria-label={`View ${period.name} settings and history`} title="View archived settings and history" onClick={()=>void inspectArchivedPeriod(period)}><Eye className="size-4"/></Button>:<Button size="sm" variant="outline" title="Edit period settings" onClick={()=>editPeriod(period)}>Edit</Button>}</td></tr>})}</tbody></table>{visiblePeriods.length===0&&<p className="p-3 text-xs text-slate-600">No periods match these filters.</p>}</div></>}
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{saved&&<p role="status" className="text-sm text-green-800">{saved}</p>}
    </section>
  </details>
  {formOpen&&<WindowSurface title={editingId?"Edit submission window":"Add submission window"} onBack={resetForm} compact={false} assistant={false}>
    <form onSubmit={event=>{event.preventDefault();setConfirming(true)}} className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
      <h2 className="text-base font-semibold text-red-950">{editingId?"Edit submission window":"Add submission window"}</h2>
      <p className="text-xs text-slate-600">Set any work-period length. Default follow-up runs in the next week: employees and contractors Monday 5 PM; managers Wednesday 5 PM; account approvals Thursday 5 PM; exceptions Friday noon. Account managers can change these dates and times.</p>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period name<input aria-label="Timesheet period name" value={name} onChange={event=>{setName(event.target.value);setNameEdited(true)}} maxLength={100} placeholder="2026-10-24 - 2026-10-30" className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work starts<input aria-label="Period start date" type="date" value={startDate} onChange={event=>{setStartDate(event.target.value);if(!nameEdited&&event.target.value&&endDate)setName(event.target.value+" - "+endDate)}} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work ends<input aria-label="Period end date" type="date" min={startDate||undefined} value={endDate} onChange={event=>{changePeriodEnd(event.target.value);if(!nameEdited&&startDate&&event.target.value)setName(startDate+" - "+event.target.value)}} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Employee/contractor deadline<input aria-label="Period submission deadline" type="datetime-local" value={deadline} onChange={event=>changeWorkerDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager deadline<input aria-label="Manager submission deadline" type="datetime-local" value={managerDeadline||localInput(undefined,2)} onChange={event=>setManagerDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Account approval deadline<input aria-label="Account approval deadline" type="datetime-local" value={accountDeadline||localInput(undefined,3)} onChange={event=>setAccountDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Exception resolution deadline<input aria-label="Exception resolution deadline" type="datetime-local" value={resolutionDeadline||localInput(undefined,4,12)} onChange={event=>setResolutionDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period timezone<select aria-label="Timesheet timezone" value={timezone} onChange={event=>setTimezone(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"><option value="America/New_York">United States · Eastern</option><option value="Africa/Nairobi">Kenya · Nairobi</option></select></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager grace (days)<input aria-label="Manager grace days" type="number" min={0} max={30} value={managerGraceDays} onChange={event=>setManagerGraceDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Reminder lead (days)<input aria-label="Reminder lead days" type="number" min={1} max={30} value={reminderDays} onChange={event=>setReminderDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      {editingId&&<label className="grid gap-1 text-xs font-medium text-slate-700 sm:col-span-2">Reason for changing this period<input aria-label="Period change reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} placeholder="Explain the deadline or window override" className="h-9 rounded-md border border-orange-200 bg-white px-2 text-sm"/></label>}
      </div>
      {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-red-200 pt-3"><Button type="button" variant="outline" disabled={saving} onClick={resetForm}>Cancel</Button><Button type="submit" disabled={loading||saving||!name.trim()||!startDate||!endDate||!deadline||endDate<today||(!!editingId&&reason.trim().length<5)}><Save className="size-4"/>{editingId?"Save changes":"Save"}</Button></div>
      </div>
    </form>
    {confirming&&<WindowSurface title={editingId?"Confirm period change":"Confirm timesheet period"} compact resizable disabled={saving} onBack={()=>setConfirming(false)}><section className="w-full max-w-xl space-y-3 bg-white p-4 text-slate-950"><p className="text-sm">{editingId?"Update":"Save"} <strong>{name}</strong> for work dates {startDate} through {endDate}, with submissions due {new Date(deadline).toLocaleString()}?</p><p className="text-xs text-slate-600">Work dates cannot overlap another period. Reminders are sent {reminderDays} days before the deadline. Managers receive {managerGraceDays} additional days.</p>{editingId&&<p className="border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm">Reason: {reason}</p>}{error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={()=>setConfirming(false)}>Cancel</Button><Button type="button" disabled={saving} onClick={()=>void savePeriod()}>{saving?"Saving...":editingId?"Save changes":"Save period"}</Button></div></section></WindowSurface>}
  </WindowSurface>}
  {selectedArchived&&<WindowSurface title="Archived period settings" onBack={()=>setSelectedArchived(null)} compact={false} assistant={false}><section className="flex h-full min-h-0 w-full flex-col bg-white"><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"><div><h2 className="text-base font-semibold">{selectedArchived.name}</h2><p className="text-xs text-slate-600">Archived · read-only · ID {selectedArchived.id}</p></div><dl className="grid gap-x-8 gap-y-3 border-y border-slate-200 py-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Work dates</dt><dd>{selectedArchived.startDate} to {selectedArchived.endDate}</dd></div><div><dt className="text-xs text-slate-500">Timezone</dt><dd>{selectedArchived.timezone??"America/New_York"}</dd></div><div><dt className="text-xs text-slate-500">Employee / contractor deadline</dt><dd>{new Date(selectedArchived.submissionDeadline).toLocaleString(undefined,{timeZone:selectedArchived.timezone||"America/New_York",dateStyle:"medium",timeStyle:"short"})}</dd></div><div><dt className="text-xs text-slate-500">Manager deadline</dt><dd>{selectedArchived.managerSubmissionDeadline?new Date(selectedArchived.managerSubmissionDeadline).toLocaleString(undefined,{timeZone:selectedArchived.timezone||"America/New_York",dateStyle:"medium",timeStyle:"short"}):"Not configured"}</dd></div><div><dt className="text-xs text-slate-500">Account approval deadline</dt><dd>{selectedArchived.accountApprovalDeadline?new Date(selectedArchived.accountApprovalDeadline).toLocaleString(undefined,{timeZone:selectedArchived.timezone||"America/New_York",dateStyle:"medium",timeStyle:"short"}):"Not configured"}</dd></div><div><dt className="text-xs text-slate-500">Exception resolution deadline</dt><dd>{selectedArchived.exceptionResolutionDeadline?new Date(selectedArchived.exceptionResolutionDeadline).toLocaleString(undefined,{timeZone:selectedArchived.timezone||"America/New_York",dateStyle:"medium",timeStyle:"short"}):"Not configured"}</dd></div><div><dt className="text-xs text-slate-500">Manager grace</dt><dd>{selectedArchived.managerGraceDays} days</dd></div><div><dt className="text-xs text-slate-500">Reminder lead</dt><dd>{selectedArchived.reminderDays} days</dd></div></dl><section><h3 className="mb-2 text-sm font-semibold">Set by and change history</h3>{historyLoading?<p role="status" className="text-sm text-slate-600">Loading history…</p>:<>{historyError&&<p role="alert" className="mb-2 text-sm text-red-800">{historyError}</p>}{archivedHistory.length===0?<p className="text-sm text-slate-600">No audit history is available for this period.</p>:<ol className="divide-y divide-slate-200 border-y border-slate-200">{archivedHistory.map((event,index)=><li key={`${event.actorEmail}-${event.occurredAt}-${index}`} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-medium">{event.action==="timesheet_period_created"?"Period created":"Settings changed"} by {event.actorEmail}</p>{event.reason&&<p className="text-xs text-slate-600">Reason: {event.reason}</p>}</div><time className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>}</>}</section></div><footer className="flex shrink-0 justify-end border-t border-slate-200 p-3"><Button variant="outline" onClick={()=>setSelectedArchived(null)}>Close</Button></footer></section></WindowSurface>}
  {aboutOpen&&<WindowSurface title="About timesheet periods" onBack={()=>setAboutOpen(false)} compact assistant={false}><section className="w-full space-y-3 bg-white p-4 text-sm"><p>Each period has a unique ID and non-overlapping work dates. The schedule records worker submission, manager review, account approval, and exception-resolution deadlines in the period timezone.</p><p>Archived periods remain available for inspection but cannot be changed. Open an archived period to review its settings and audit history.</p><p>Managers receive the configured grace period; reminder lead time is counted from the worker deadline.</p></section></WindowSurface>}</>
}
