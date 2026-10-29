"use client"

import {useEffect,useState} from "react"
import {Activity,CircleAlert,ShieldCheck} from "lucide-react"
import {apiPath} from "@/lib/paths"

type ActivityItem={id:string;action:string;targetType:string;occurredAt:string;requiresAttention?:boolean;acknowledged?:boolean}
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
  const [acknowledgementError,setAcknowledgementError]=useState("")
  useEffect(()=>{
    const controller=new AbortController()
    fetch(apiPath("/api/account-activity"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not load account activity.")
      setEvents(data.events??[])
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load account activity.")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[])
  async function acknowledge(event:ActivityItem){
    if(!event.requiresAttention||event.acknowledged)return
    setAcknowledgementError("")
    setEvents(current=>current.map(item=>item.id===event.id?{...item,acknowledged:true}:item))
    try{
      const response=await fetch(apiPath("/api/account-activity"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:event.id})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not acknowledge this activity item.")
    }catch(cause){
      setEvents(current=>current.map(item=>item.id===event.id?{...item,acknowledged:false}:item))
      setAcknowledgementError(cause instanceof Error?cause.message:"Could not acknowledge this activity item.")
    }
  }
  return <section aria-label="Account activity" className="min-h-0 w-full overflow-auto bg-white p-4 sm:p-6">
    <header className="mb-4 flex items-center gap-3 border-b border-blue-200 bg-gradient-to-r from-blue-50 via-white to-orange-50 px-4 py-3"><span className="grid size-9 place-items-center rounded-md bg-blue-700 text-white"><ShieldCheck className="size-5"/></span><div><h2 className="font-semibold text-blue-950">Account activity</h2><p className="text-sm text-blue-900">A private history of account changes and actions on your timesheet records.</p></div></header>
    {acknowledgementError&&<p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{acknowledgementError}</p>}
    {loading?<p role="status" className="p-4 text-sm text-slate-600">Loading account activity…</p>:error?<p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>:events.length===0?<div className="flex min-h-40 flex-col items-center justify-center gap-2 border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><Activity className="size-6 text-slate-500"/><p className="text-sm font-medium text-slate-800">No account actions recorded</p><p className="max-w-lg text-xs text-slate-600">Account changes and timesheet reviews will appear here when they are recorded.</p></div>:<ol className="divide-y divide-slate-200 border border-slate-200">{events.map(event=>{
      const needsAttention=!!event.requiresAttention&&!event.acknowledged
      const content=<><span className="flex items-center gap-2"><span className="text-sm font-medium text-slate-900">{actionLabels[event.action]??"An authorized organization reviewer took action on your account"}</span>{needsAttention&&<span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800"><CircleAlert aria-hidden="true" className="size-3"/>Needs attention</span>}</span><span className="mt-1 block text-xs capitalize text-slate-600">{event.targetType.replaceAll("_"," ")}</span></>
      return <li key={event.id} className={`grid gap-2 border-l-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${needsAttention?"border-red-600 bg-red-50/60":"border-blue-500 bg-white"}`}>
        {needsAttention?<button type="button" aria-label={`Acknowledge activity: ${actionLabels[event.action]??"Timesheet activity"}`} onClick={()=>void acknowledge(event)} className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">{content}<span className="sr-only">Select to acknowledge that you saw this activity.</span></button>:<div className="min-w-0">{content}</div>}
        <time className="text-xs text-slate-600" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
      </li>
    })}</ol>}
  </section>
}
