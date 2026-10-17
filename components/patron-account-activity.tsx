"use client"

import {useEffect,useState} from "react"
import {Activity,ShieldCheck} from "lucide-react"
import {apiPath} from "@/lib/paths"

type ActivityItem={id:string;action:string;targetType:string;occurredAt:string}
const actionLabels:Record<string,string>={
  user_access_created:"An administrator created your account access",
  user_access_updated:"An administrator updated your account access",
  account_lifecycle_updated:"An administrator changed your account status or lifecycle",
  temporary_assignment_created:"A temporary reviewer assignment was created for your account",
  temporary_assignment_extended:"A temporary reviewer assignment was extended",
  temporary_assignment_revoked:"A temporary reviewer assignment was ended",
  entry_approved:"A reviewer approved a timesheet entry",
  entry_rejected:"A reviewer returned a timesheet entry for correction",
  entry_updated:"A reviewer or administrator edited a timesheet entry",
  entry_deleted:"A timesheet entry was removed by an authorized reviewer",
  entry_submitted:"A timesheet entry was submitted for review",
}

/** Shows a contractor only their own audited account and timesheet events. */
export function PatronAccountActivity(){
  const [events,setEvents]=useState<ActivityItem[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  useEffect(()=>{
    const controller=new AbortController()
    fetch(apiPath("/api/account-activity"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not load account activity.")
      setEvents(data.events??[])
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load account activity.")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[])
  return <section aria-label="Account activity" className="min-h-0 w-full overflow-auto bg-white p-4 sm:p-6">
    <header className="mb-4 flex items-center gap-3 border-b border-blue-200 bg-gradient-to-r from-blue-50 via-white to-orange-50 px-4 py-3"><span className="grid size-9 place-items-center rounded-md bg-blue-700 text-white"><ShieldCheck className="size-5"/></span><div><h2 className="font-semibold text-blue-950">Account activity</h2><p className="text-sm text-blue-900">A private history of account changes and actions on your timesheet records.</p></div></header>
    {loading?<p role="status" className="p-4 text-sm text-slate-600">Loading account activity…</p>:error?<p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>:events.length===0?<div className="flex min-h-40 flex-col items-center justify-center gap-2 border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><Activity className="size-6 text-slate-500"/><p className="text-sm font-medium text-slate-800">No account actions recorded</p><p className="max-w-lg text-xs text-slate-600">Account changes and timesheet reviews will appear here when they are recorded.</p></div>:<ol className="divide-y divide-slate-200 border border-slate-200">{events.map(event=><li key={event.id} className="grid gap-2 border-l-4 border-blue-500 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><p className="text-sm font-medium text-slate-900">{actionLabels[event.action]??"An authorized organization reviewer took action on your account"}</p><p className="mt-1 text-xs capitalize text-slate-600">{event.targetType.replaceAll("_"," ")}</p></div><time className="text-xs text-slate-600" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>}
  </section>
}
