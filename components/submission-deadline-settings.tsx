"use client"

import { useEffect, useState } from "react"
import { CalendarClock, Save } from "lucide-react"
import { WindowSurface } from "@/components/window-surface"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { TimesheetPeriod } from "@/lib/db"

/** Admin interface for dated work periods, reminder lead time, and manager grace. */
export function SubmissionDeadlineSettings() {
  const [periods,setPeriods]=useState<TimesheetPeriod[]>([])
  const [name,setName]=useState("")
  const [startDate,setStartDate]=useState("")
  const [endDate,setEndDate]=useState("")
  const [deadline,setDeadline]=useState("")
  const [managerGraceDays,setManagerGraceDays]=useState(3)
  const [reminderDays,setReminderDays]=useState(3)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [confirming,setConfirming]=useState(false)
  const [error,setError]=useState("")
  const [saved,setSaved]=useState("")

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
    if(!name.trim()||!startDate||!endDate||!deadline)return
    setSaving(true);setError("");setSaved("")
    try{
      const response=await fetch(apiPath("/api/timesheet-periods"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),startDate,endDate,submissionDeadline:new Date(deadline).toISOString(),managerGraceDays,reminderDays})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not save timesheet period.")
      await loadPeriods()
      setSaved(`${data.period.name} was configured.`);setName("");setStartDate("");setEndDate("");setDeadline("");setConfirming(false)
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save timesheet period.")}
    finally{setSaving(false)}
  }

  return <section aria-label="Timesheet submission periods" className="space-y-3 border-l-4 border-red-500 bg-red-50/70 p-3">
    <header className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 text-red-700"/><div><h3 className="text-sm font-semibold text-red-950">Timesheet periods and submission windows</h3><p className="text-xs text-red-900">Work dates must fall within a configured period. The hard deadline applies to employees and contractors; managers may submit during the configured grace period.</p></div></header>
    {loading?<p role="status" className="text-xs text-slate-600">Loading periods...</p>:periods.length===0?<p className="text-xs text-slate-700">No periods configured yet. Existing timesheets remain open until a period is created.</p>:<div className="max-h-40 overflow-auto border border-red-200 bg-white"><table className="w-full min-w-[680px] text-left text-xs"><thead className="sticky top-0 bg-red-100 text-red-950"><tr><th className="p-2">Period</th><th className="p-2">Work dates</th><th className="p-2">Submission deadline</th><th className="p-2">Manager grace</th><th className="p-2">Reminder</th></tr></thead><tbody>{periods.map(period=><tr key={period.id} className="border-t border-red-100"><td className="p-2 font-medium">{period.name}</td><td className="p-2">{period.startDate} - {period.endDate}</td><td className="p-2">{new Date(period.submissionDeadline).toLocaleString()}</td><td className="p-2">{period.managerGraceDays} days</td><td className="p-2">{period.reminderDays} days before</td></tr>)}</tbody></table></div>}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-slate-700">Period name<input aria-label="Timesheet period name" value={name} onChange={event=>setName(event.target.value)} maxLength={100} placeholder="October 2026" className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work starts<input aria-label="Period start date" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Work ends<input aria-label="Period end date" type="date" min={startDate||undefined} value={endDate} onChange={event=>setEndDate(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Submission deadline (local time)<input aria-label="Period submission deadline" type="datetime-local" value={deadline} onChange={event=>setDeadline(event.target.value)} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Manager grace (days)<input aria-label="Manager grace days" type="number" min={0} max={30} value={managerGraceDays} onChange={event=>setManagerGraceDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Reminder lead (days)<input aria-label="Reminder lead days" type="number" min={1} max={30} value={reminderDays} onChange={event=>setReminderDays(Number(event.target.value))} className="h-9 rounded-md border border-red-200 bg-white px-2 text-sm"/></label>
      <div className="flex items-end"><Button variant="outline" disabled={loading||saving||!name.trim()||!startDate||!endDate||!deadline} onClick={()=>setConfirming(true)}><Save className="size-4"/>Create period</Button></div>
    </div>
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{saved&&<p role="status" className="text-sm text-green-800">{saved}</p>}
    {confirming&&<WindowSurface title="Confirm timesheet period" compact resizable disabled={saving} onBack={()=>setConfirming(false)}><section className="w-full max-w-xl space-y-3 bg-white p-4 text-slate-950"><p className="text-sm">Create <strong>{name}</strong> for work dates {startDate} through {endDate}, with submissions due {new Date(deadline).toLocaleString()}?</p><p className="text-xs text-slate-600">This cannot overlap another period. Reminders are sent {reminderDays} days before the deadline. Managers receive {managerGraceDays} additional days.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirming(false)}>Cancel</Button><Button disabled={saving} onClick={()=>void savePeriod()}>{saving?"Saving...":"Confirm period"}</Button></div></section></WindowSurface>}
  </section>
}
