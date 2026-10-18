"use client"

import { useEffect, useState } from "react"
import { CalendarClock, ChevronRight, Save } from "lucide-react"
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
  const [managerGraceDays,setManagerGraceDays]=useState(3)
  const [reminderDays,setReminderDays]=useState(3)
  const [editingId,setEditingId]=useState<string|null>(null)
  const [reason,setReason]=useState("")
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [confirming,setConfirming]=useState(false)
  const [error,setError]=useState("")
  const [saved,setSaved]=useState("")
  const now=new Date()
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`

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
      const payload={name:name.trim(),startDate,endDate,submissionDeadline:new Date(deadline).toISOString(),managerGraceDays,reminderDays}
      const response=await fetch(apiPath("/api/timesheet-periods"),{method:editingId?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(editingId?{id:editingId,...payload,reason:reason.trim()}:payload)})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not save timesheet period.")
      await loadPeriods()
      setSaved(`${data.period.name} was ${editingId?"updated":"configured"}.`);setName("");setStartDate("");setEndDate("");setDeadline("");setReason("");setEditingId(null);setConfirming(false)
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save timesheet period.")}
    finally{setSaving(false)}
  }

  function editPeriod(period:TimesheetPeriod) {
    if(period.endDate<today){setError("Past periods are archived and cannot be edited.");return}
    const date=new Date(period.submissionDeadline)
    setEditingId(period.id);setName(period.name);setStartDate(period.startDate);setEndDate(period.endDate)
    setDeadline(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`)
    setManagerGraceDays(period.managerGraceDays);setReminderDays(period.reminderDays);setReason("");setError("")
  }

  return <details open={defaultOpen} className="group rounded-md border border-red-200 bg-red-50/60">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 [&::-webkit-details-marker]:hidden">
      <CalendarClock className="size-4 shrink-0 text-red-700"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-red-950">Timesheet periods and deadlines</span><span className="block text-[11px] text-red-900">{periods.length} configured · submission windows and reminders</span></span>
      <ChevronRight className="size-4 shrink-0 text-red-800 transition-transform group-open:rotate-90" aria-hidden="true"/>
    </summary>
    <section aria-label="Timesheet submission periods" className="space-y-3 border-t border-red-200 px-3 py-2.5">
    <p className="text-xs text-red-900">Work dates must fall within a configured period. Current and future periods can be changed; past periods are archived and read-only. Employees and contractors follow the hard deadline; managers may submit during the configured grace period.</p>
    {loading?<p role="status" className="text-xs text-slate-600">Loading periods...</p>:periods.length===0?<p className="text-xs text-slate-700">No periods configured yet. Existing timesheets remain open until a period is created.</p>:<div className="max-h-48 overflow-auto border border-red-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-red-100 text-red-950"><tr><th className="p-2">Period</th><th className="p-2">Work dates</th><th className="p-2">Submission deadline</th><th className="p-2">Manager grace</th><th className="p-2">Reminder</th><th className="p-2">Actions</th></tr></thead><tbody>{periods.map(period=>{const archived=period.endDate<today;return <tr key={period.id} className="border-t border-red-100"><td className="p-2 font-medium">{period.name}{archived&&<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Archived</span>}</td><td className="p-2">{period.startDate} - {period.endDate}</td><td className="p-2">{new Date(period.submissionDeadline).toLocaleString()}</td><td className="p-2">{period.managerGraceDays} days</td><td className="p-2">{period.reminderDays} days before</td><td className="p-2">{archived?<Button size="sm" variant="outline" disabled title="Past periods are archived and read-only">Archived</Button>:<Button size="sm" variant="outline" onClick={()=>editPeriod(period)}>Edit window</Button>}</td></tr>})}</tbody></table></div>}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period name<input aria-label="Timesheet period name" value={name} onChange={event=>setName(event.target.value)} maxLength={100} placeholder="October 2026" className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work starts<input aria-label="Period start date" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work ends<input aria-label="Period end date" type="date" min={startDate||undefined} value={endDate} onChange={event=>setEndDate(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Submission deadline (local time)<input aria-label="Period submission deadline" type="datetime-local" value={deadline} onChange={event=>setDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager grace (days)<input aria-label="Manager grace days" type="number" min={0} max={30} value={managerGraceDays} onChange={event=>setManagerGraceDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Reminder lead (days)<input aria-label="Reminder lead days" type="number" min={1} max={30} value={reminderDays} onChange={event=>setReminderDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      {editingId&&<label className="grid gap-1 text-xs font-medium text-slate-700 sm:col-span-2">Reason for changing this period<input aria-label="Period change reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} placeholder="Explain the deadline or window override" className="h-9 rounded-md border border-orange-200 bg-white px-2 text-sm"/></label>}
    </div>
    <div className="sticky bottom-0 z-10 -mx-3 flex items-center justify-between gap-3 border-t border-red-200 bg-white/95 px-3 py-2 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur">
      <p className="text-xs text-slate-600">{editingId?"Review the changes and save this period.":"Create a current or future submission window."}</p>
      <div className="flex shrink-0 items-center gap-2">{editingId&&<Button variant="outline" onClick={()=>{setEditingId(null);setName("");setStartDate("");setEndDate("");setDeadline("");setReason("")}}>Cancel edit</Button>}<Button disabled={loading||saving||!name.trim()||!startDate||!endDate||!deadline||endDate<today||(!!editingId&&reason.trim().length<5)} onClick={()=>setConfirming(true)}><Save className="size-4"/>{editingId?"Save period changes":"Create new period"}</Button></div>
    </div>
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{saved&&<p role="status" className="text-sm text-green-800">{saved}</p>}
    {confirming&&<WindowSurface title={editingId?"Confirm period change":"Confirm timesheet period"} compact resizable disabled={saving} onBack={()=>setConfirming(false)}><section className="w-full max-w-xl space-y-3 bg-white p-4 text-slate-950"><p className="text-sm">{editingId?"Update":"Create"} <strong>{name}</strong> for work dates {startDate} through {endDate}, with submissions due {new Date(deadline).toLocaleString()}?</p><p className="text-xs text-slate-600">Work dates cannot overlap another period. Reminders are sent {reminderDays} days before the deadline. Managers receive {managerGraceDays} additional days.</p>{editingId&&<p className="border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm">Reason: {reason}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirming(false)}>Cancel</Button><Button disabled={saving} onClick={()=>void savePeriod()}>{saving?"Saving...":editingId?"Confirm changes":"Confirm period"}</Button></div></section></WindowSurface>}
    </section>
  </details>
}
