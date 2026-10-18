"use client"

import { useCallback,useEffect,useState } from "react"
import { Check,Clock3,RefreshCw,X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string}
type ExtensionRequest={id:string;requesterEmail:string;requesterName:string;periodId:string;periodName:string;assignedTo:string;reason:string;requestedUntil:string;status:"pending"|"approved"|"denied";reviewedAt:string|null;managerNote:string;approvedUntil:string|null;createdAt:string}

function localDateTime(value:Date){const local=new Date(value.getTime()-value.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}
function formatDate(value:string){return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}

/** Patron request form and assigned account-manager decision queue. */
export function SubmissionExtensionPanel({reviewer,onClose}:{reviewer:boolean;onClose:()=>void}){
  const [periods,setPeriods]=useState<Period[]>([])
  const [requests,setRequests]=useState<ExtensionRequest[]>([])
  const [periodId,setPeriodId]=useState("")
  const [reason,setReason]=useState("")
  const [requestedUntil,setRequestedUntil]=useState(()=>localDateTime(new Date(Date.now()+3*86_400_000)))
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [message,setMessage]=useState("")

  const load=useCallback(async()=>{
    setError("")
    try{
      const [requestResponse,periodResponse]=await Promise.all([
        fetch(apiPath("/api/submission-extensions"),{cache:"no-store"}),
        reviewer?Promise.resolve(null):fetch(apiPath("/api/timesheet-periods"),{cache:"no-store"}),
      ])
      const requestData=await requestResponse.json()
      if(!requestResponse.ok)throw new Error(requestData.error??"Requests could not be loaded.")
      setRequests(requestData.requests??[])
      if(periodResponse){const periodData=await periodResponse.json();if(!periodResponse.ok)throw new Error(periodData.error??"Periods could not be loaded.");setPeriods(periodData.periods??[])}
    }catch(cause){setError(cause instanceof Error?cause.message:"Requests could not be loaded.")}
  },[reviewer])
  useEffect(()=>{void load()},[load])

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError("");setMessage("")
    try{
      const response=await fetch(apiPath("/api/submission-extensions"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({periodId,reason,requestedUntil:new Date(requestedUntil).toISOString()})})
      const data=await response.json();if(!response.ok)throw new Error(data.error??"The request could not be sent.")
      setReason("");setMessage("Request sent to your account manager.");await load()
    }catch(cause){setError(cause instanceof Error?cause.message:"The request could not be sent.")}
    finally{setBusy(false)}
  }

  const decide=async(request:ExtensionRequest,decision:"approved"|"denied")=>{
    setBusy(true);setError("");setMessage("")
    try{
      const response=await fetch(apiPath(`/api/submission-extensions/${request.id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision,managerNote:notes[request.id]??""})})
      const data=await response.json();if(!response.ok)throw new Error(data.error??"The decision could not be saved.")
      setMessage(`Request ${decision}.`);await load()
    }catch(cause){setError(cause instanceof Error?cause.message:"The decision could not be saved.")}
    finally{setBusy(false)}
  }

  const currentPeriods=periods
  return <WindowSurface title={reviewer?"Extension requests":"Request a timesheet extension"} onBack={onClose}>
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-3 py-2"><div><h2 className="text-sm font-semibold text-sky-950">{reviewer?"Assigned requests":"Deadline extension"}</h2><p className="text-xs text-slate-700">{reviewer?"Review requests routed to your account-manager queue.":"Available to every employee and contractor patron."}</p></div><Button size="icon" variant="outline" title="Refresh requests" aria-label="Refresh requests" onClick={()=>void load()}><RefreshCw className="size-4"/></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
        {error&&<p role="alert" className="mb-3 border border-red-300 bg-red-50 p-2 text-sm text-red-900">{error}</p>}{message&&<p role="status" className="mb-3 border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">{message}</p>}
        {!reviewer&&<form onSubmit={submit} className="mb-4 grid gap-2 border border-orange-200 bg-orange-50/50 p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-slate-800">Timesheet period<select required value={periodId} onChange={event=>{const next=event.target.value;setPeriodId(next);const selected=periods.find(period=>period.id===next);if(selected)setRequestedUntil(localDateTime(new Date(Math.max(Date.now()+3*86_400_000,Date.parse(selected.submissionDeadline)+3*86_400_000))))}} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"><option value="">Select period</option>{currentPeriods.map(period=><option key={period.id} value={period.id}>{period.name} · due {formatDate(period.submissionDeadline)}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium text-slate-800">Requested deadline<input required type="datetime-local" min={localDateTime(new Date(Date.now()+60_000))} max={localDateTime(new Date(Date.now()+90*86_400_000))} value={requestedUntil} onChange={event=>setRequestedUntil(event.target.value)} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-800 sm:col-span-2">Reason<textarea required minLength={5} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Why do you need additional time?" className="min-h-16 rounded border border-slate-300 bg-white p-2 text-sm"/></label>
          <p className="text-xs text-slate-600 sm:col-span-2">The request applies only to your entries in this period. An account manager must approve it before the requested deadline, within the next 90 days.</p>
          <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={busy||!periodId||reason.trim().length<5}>{busy?"Sending…":"Send request"}</Button>
        </form>}
        <div className="space-y-2">{requests.length===0?<p className="border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{reviewer?"No extension requests are assigned to you.":"You have no extension requests yet."}</p>:requests.map(request=><article key={request.id} className="border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"><div><h3 className="text-sm font-semibold">{reviewer?request.requesterName:"Your request"} · {request.periodName}</h3><p className="text-xs text-slate-600">Requested until {formatDate(request.requestedUntil)} · sent {formatDate(request.createdAt)}</p></div><span className={`border px-2 py-0.5 text-xs font-semibold capitalize ${request.status==="approved"?"border-emerald-300 bg-emerald-50 text-emerald-900":request.status==="denied"?"border-red-300 bg-red-50 text-red-900":"border-orange-300 bg-orange-50 text-orange-950"}`}>{request.status}</span></div>
          <p className="px-3 py-2 text-sm">{request.reason}</p>{request.status==="approved"&&request.approvedUntil&&<p className="px-3 pb-2 text-xs font-semibold text-emerald-900">Submit by {formatDate(request.approvedUntil)}</p>}{request.managerNote&&<p className="mx-3 mb-2 border-l-2 border-sky-400 bg-sky-50 px-2 py-1 text-xs text-sky-950">Manager: {request.managerNote}</p>}
          {reviewer&&request.status==="pending"&&<div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-2"><input aria-label={`Decision note for ${request.requesterName}`} maxLength={500} value={notes[request.id]??""} onChange={event=>setNotes(previous=>({...previous,[request.id]:event.target.value}))} placeholder="Optional note" className="h-8 min-w-48 flex-1 rounded border border-slate-300 px-2 text-sm"/><Button variant="outline" disabled={busy} onClick={()=>void decide(request,"denied")}><X className="size-4"/>Deny</Button><Button disabled={busy} onClick={()=>void decide(request,"approved")}><Check className="size-4"/>Approve</Button></div>}
          {!reviewer&&request.status==="pending"&&<p className="flex items-center gap-1 px-3 pb-2 text-xs text-slate-600"><Clock3 className="size-3.5"/>Waiting for {request.assignedTo}</p>}
        </article>)}</div>
      </div>
    </section>
  </WindowSurface>
}
