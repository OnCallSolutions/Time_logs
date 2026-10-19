"use client"

import { useEffect, useState } from "react"
import { CalendarClock, ChevronRight, Plus, Save } from "lucide-react"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { TimesheetPeriod } from "@/lib/db"

/** Admin interface for dated work periods, reminder lead time, and manager grace. */
export function SubmissionDeadlineSettings({defaultOpen=false}:{defaultOpen?:boolean}) {
  const [periods,setPeriods]=useState<TimesheetPeriod[]>([])
  const [name,setName]=useState("")
  const [startDate,setStartDate]=useState("")
  const [endDate,setEndDate]=useState("")
  const [deadline,setDeadline]=useState("")
  const [managerDeadline,setManagerDeadline]=useState("")
  const [accountDeadline,setAccountDeadline]=useState("")
  const [resolutionDeadline,setResolutionDeadline]=useState("")
  const [timezone,setTimezone]=useState("America/New_York")
  const [managerGraceDays,setManagerGraceDays]=useState(3)
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
  const now=new Date()
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`
  const visiblePeriods=periods.filter(period=>{
    const current=period.startDate<=today&&period.endDate>=today
    const upcoming=period.startDate>today
    const matchesState=periodStateFilter==="all"||periodStateFilter==="current"&&current||periodStateFilter==="upcoming"&&upcoming||periodStateFilter==="archived"&&period.endDate<today
    return matchesState&&(!periodSearch.trim()||`${period.name} ${period.startDate} ${period.endDate}`.toLowerCase().includes(periodSearch.trim().toLowerCase()))
  })

  function dateInput(date:Date,hour=17):string{
    const value=new Date(date);value.setHours(hour,0,0,0)
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}T${String(value.getHours()).padStart(2,"0")}:${String(value.getMinutes()).padStart(2,"0")}`
  }

  function defaultDeadlines(endDate:string){
    if(!endDate)return {worker:"",manager:"",accounts:"",issues:""}
    const [year,month,day]=endDate.split("-").map(Number)
    const end=new Date(year,month-1,day)
    const daysUntilNextMonday=(8-end.getDay())%7||7
    const worker=new Date(end);worker.setDate(worker.getDate()+daysUntilNextMonday)
    const manager=new Date(worker);manager.setDate(manager.getDate()+2)
    const accounts=new Date(worker);accounts.setDate(accounts.getDate()+3)
    const issues=new Date(worker);issues.setDate(issues.getDate()+4)
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
    setPeriods(data.periods??[])
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
      const payload={name:name.trim(),startDate,endDate,submissionDeadline:new Date(deadline).toISOString(),managerSubmissionDeadline:managerDeadline?new Date(managerDeadline).toISOString():undefined,accountApprovalDeadline:accountDeadline?new Date(accountDeadline).toISOString():undefined,exceptionResolutionDeadline:resolutionDeadline?new Date(resolutionDeadline).toISOString():undefined,timezone,managerGraceDays,reminderDays}
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
    const start=new Date();start.setHours(12,0,0,0);start.setDate(start.getDate()+((6-start.getDay()+7)%7||7))
    const end=new Date(start);end.setDate(end.getDate()+6)
    const endDate=`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`
    const deadlines=defaultDeadlines(endDate)
    setFormOpen(false);setEditingId(null);setName("");setStartDate(`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`);setEndDate(endDate);setDeadline(deadlines.worker);setManagerDeadline(deadlines.manager);setAccountDeadline(deadlines.accounts);setResolutionDeadline(deadlines.issues);setTimezone("America/New_York");setReason("");setError("")
  }

  function localInput(value:string|undefined,fallbackDays:number,fallbackHour=17){
    const date=value?new Date(value):deadline?new Date(new Date(deadline).getTime()+fallbackDays*86_400_000):new Date()
    if(!value&&deadline){date.setHours(fallbackHour,0,0,0)}
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`
  }

  function changeWorkerDeadline(value:string){
    setDeadline(value)
    if(!value)return
    const base=new Date(value)
    const shifted=(days:number,hour=base.getHours())=>{const date=new Date(base);date.setDate(date.getDate()+days);date.setHours(hour,0,0,0);return localInput(date.toISOString(),0)}
    setManagerDeadline(shifted(2));setAccountDeadline(shifted(3));setResolutionDeadline(shifted(4,12))
  }

  function editPeriod(period:TimesheetPeriod) {
    if(period.endDate<today){setError("Past periods are archived and cannot be edited.");return}
    const date=new Date(period.submissionDeadline)
    setEditingId(period.id);setName(period.name);setStartDate(period.startDate);setEndDate(period.endDate)
    setDeadline(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`)
    setManagerDeadline(localInput(period.managerSubmissionDeadline,2));setAccountDeadline(localInput(period.accountApprovalDeadline,3));setResolutionDeadline(localInput(period.exceptionResolutionDeadline,4,12));setTimezone(period.timezone||"America/New_York")
    setManagerGraceDays(period.managerGraceDays);setReminderDays(period.reminderDays);setReason("");setError("");setFormOpen(true)
  }

  return <><details open={defaultOpen} className="group flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-red-200 bg-red-50/60">
    <summary className="flex shrink-0 cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 [&::-webkit-details-marker]:hidden">
      <CalendarClock className="size-4 shrink-0 text-red-700"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-red-950">Timesheet periods and deadlines</span><span className="block text-[11px] text-red-900">{periods.length} configured · submission windows and reminders</span></span>
      <ChevronRight className="size-4 shrink-0 text-red-800 transition-transform group-open:rotate-90" aria-hidden="true"/>
    </summary>
    <section aria-label="Timesheet submission periods" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border-t border-red-200 px-3 py-2">
    <p className="shrink-0 text-xs text-red-900">Work dates must fall within a configured period. Current and future periods can be changed; past periods are archived and read-only. Employees and contractors follow the hard deadline; managers may submit during the configured grace period.</p>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-600">{periods.length} configured periods</p><Button size="sm" onClick={()=>{resetForm();setFormOpen(true)}}><Plus className="size-4"/>Add period</Button></div>
    {loading?<p role="status" className="shrink-0 text-xs text-slate-600">Loading periods...</p>:periods.length===0?<p className="shrink-0 text-xs text-slate-700">No periods configured yet. Existing timesheets remain open until a period is created.</p>:<><div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]"><label className="sr-only" htmlFor="period-settings-search">Search configured periods</label><input id="period-settings-search" type="search" value={periodSearch} onChange={event=>setPeriodSearch(event.target.value)} placeholder="Search period name or dates" className="h-8 min-w-0 border border-slate-300 bg-white px-2 text-xs"/><label className="sr-only" htmlFor="period-settings-filter">Filter periods by state</label><select id="period-settings-filter" value={periodStateFilter} onChange={event=>setPeriodStateFilter(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-xs"><option value="all">All period states</option><option value="current">Current</option><option value="upcoming">Upcoming</option><option value="archived">Archived</option></select></div><div className="min-h-0 min-w-0 flex-1 overflow-auto border border-red-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-red-100 text-red-950"><tr><th className="p-2">Period</th><th className="p-2">Work dates</th><th className="p-2">Submission deadline</th><th className="p-2">Manager grace</th><th className="p-2">Reminder</th><th className="p-2">Actions</th></tr></thead><tbody>{visiblePeriods.map(period=>{const archived=period.endDate<today;return <tr key={period.id} className="border-t border-red-100"><td className="p-2 font-medium">{period.name}{archived&&<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Archived</span>}</td><td className="p-2">{period.startDate} - {period.endDate}</td><td className="p-2">{new Date(period.submissionDeadline).toLocaleString()}</td><td className="p-2">{period.managerGraceDays} days</td><td className="p-2">{period.reminderDays} days before</td><td className="p-2">{archived?<Button size="sm" variant="outline" disabled title="Past periods are archived and read-only">Archived</Button>:<Button size="sm" variant="outline" onClick={()=>editPeriod(period)}>Edit window</Button>}</td></tr>})}</tbody></table>{visiblePeriods.length===0&&<p className="p-3 text-xs text-slate-600">No periods match these filters.</p>}</div></>}
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{saved&&<p role="status" className="text-sm text-green-800">{saved}</p>}
    </section>
  </details>
  {formOpen&&<WindowSurface title={editingId?"Edit submission window":"Add submission window"} onBack={resetForm} compact initialExpanded={false} movable assistant={false}>
    <form onSubmit={event=>{event.preventDefault();setConfirming(true)}} className="flex h-full min-h-0 w-full max-w-4xl flex-col bg-white">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
      <h2 className="text-base font-semibold text-red-950">{editingId?"Edit submission window":"Add submission window"}</h2>
      <p className="text-xs text-slate-600">Set any work-period length. Default follow-up runs in the next week: employees and contractors Monday 5 PM; managers Wednesday 5 PM; account approvals Thursday 5 PM; exceptions Friday noon. Account managers can change these dates and times.</p>
      <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period name<input aria-label="Timesheet period name" value={name} onChange={event=>setName(event.target.value)} maxLength={100} placeholder="October 2026" className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work starts<input aria-label="Period start date" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work ends<input aria-label="Period end date" type="date" min={startDate||undefined} value={endDate} onChange={event=>changePeriodEnd(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Employee/contractor deadline<input aria-label="Period submission deadline" type="datetime-local" value={deadline} onChange={event=>changeWorkerDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager deadline<input aria-label="Manager submission deadline" type="datetime-local" value={managerDeadline||localInput(undefined,2)} onChange={event=>setManagerDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Account approval deadline<input aria-label="Account approval deadline" type="datetime-local" value={accountDeadline||localInput(undefined,3)} onChange={event=>setAccountDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Exception resolution deadline<input aria-label="Exception resolution deadline" type="datetime-local" value={resolutionDeadline||localInput(undefined,4,12)} onChange={event=>setResolutionDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period timezone<input aria-label="Timesheet timezone" value={timezone} onChange={event=>setTimezone(event.target.value)} placeholder="America/New_York" className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager grace (days)<input aria-label="Manager grace days" type="number" min={0} max={30} value={managerGraceDays} onChange={event=>setManagerGraceDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Reminder lead (days)<input aria-label="Reminder lead days" type="number" min={1} max={30} value={reminderDays} onChange={event=>setReminderDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      {editingId&&<label className="grid gap-1 text-xs font-medium text-slate-700 sm:col-span-2">Reason for changing this period<input aria-label="Period change reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} placeholder="Explain the deadline or window override" className="h-9 rounded-md border border-orange-200 bg-white px-2 text-sm"/></label>}
      </div>
      {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-red-200 bg-white px-4 py-3">
        <p className="text-xs text-slate-600">{editingId?"Save the updated dates and deadline.":"Create a current or future submission window."}</p>
        <div className="flex shrink-0 items-center gap-2"><Button type="button" variant="outline" disabled={saving} onClick={resetForm}>Cancel</Button><Button type="submit" disabled={loading||saving||!name.trim()||!startDate||!endDate||!deadline||endDate<today||(!!editingId&&reason.trim().length<5)}><Save className="size-4"/>{editingId?"Save changes":"Create period"}</Button></div>
      </footer>
    </form>
    {confirming&&<WindowSurface title={editingId?"Confirm period change":"Confirm timesheet period"} compact resizable disabled={saving} onBack={()=>setConfirming(false)}><section className="w-full max-w-xl space-y-3 bg-white p-4 text-slate-950"><p className="text-sm">{editingId?"Update":"Create"} <strong>{name}</strong> for work dates {startDate} through {endDate}, with submissions due {new Date(deadline).toLocaleString()}?</p><p className="text-xs text-slate-600">Work dates cannot overlap another period. Reminders are sent {reminderDays} days before the deadline. Managers receive {managerGraceDays} additional days.</p>{editingId&&<p className="border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm">Reason: {reason}</p>}{error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={()=>setConfirming(false)}>Cancel</Button><Button type="button" disabled={saving} onClick={()=>void savePeriod()}>{saving?"Saving...":editingId?"Confirm changes":"Confirm period"}</Button></div></section></WindowSurface>}
  </WindowSurface>}</>
}
