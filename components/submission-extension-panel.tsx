"use client"

import { useCallback,useEffect,useState } from "react"
import { Check,Clock3,RefreshCw,X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;managerSubmissionDeadline?:string;accountApprovalDeadline?:string;managerGraceDays:number}
type ExtensionRequest={id:string;requesterEmail:string;requesterName:string;periodId:string;periodName:string;assignedTo:string;reason:string;requestedUntil:string;status:"pending"|"approved"|"denied";reviewedAt:string|null;managerNote:string;approvedUntil:string|null;createdAt:string}

function localDateTime(value:Date){const local=new Date(value.getTime()-value.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16)}
function extensionCap(period:Period,manager=false){return new Date(manager?(period.accountApprovalDeadline??period.submissionDeadline):(period.managerSubmissionDeadline??new Date(Date.parse(period.submissionDeadline)+period.managerGraceDays*86_400_000).toISOString()))}
function formatDate(value:string){return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}

/** Patron request form and assigned account-manager decision queue. */
export function SubmissionExtensionPanel({reviewer,canRequest=!reviewer,requesterRole="contractor",onClose}:{reviewer:boolean;canRequest?:boolean;requesterRole?:"manager"|"employee"|"contractor";onClose:()=>void}){
  const [periods,setPeriods]=useState<Period[]>([])
  const [requests,setRequests]=useState<ExtensionRequest[]>([])
  const [periodId,setPeriodId]=useState("")
  const [reason,setReason]=useState("")
  const [requestedUntil,setRequestedUntil]=useState(()=>localDateTime(new Date(Date.now()+3*86_400_000)))
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [approvedUntil,setApprovedUntil]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [message,setMessage]=useState("")

  const load=useCallback(async()=>{
    setError("")
    try{
      const [requestResponse,periodResponse]=await Promise.all([
        fetch(apiPath("/api/submission-extensions"),{cache:"no-store"}),
        canRequest?fetch(apiPath("/api/timesheet-periods"),{cache:"no-store"}):Promise.resolve(null),
      ])
      const requestData=await requestResponse.json()
      if(!requestResponse.ok)throw new Error(requestData.error??"Requests could not be loaded.")
      setRequests(requestData.requests??[])
      if(periodResponse){const periodData=await periodResponse.json();if(!periodResponse.ok)throw new Error(periodData.error??"Periods could not be loaded.");setPeriods(periodData.periods??[])}
    }catch(cause){setError(cause instanceof Error?cause.message:"Requests could not be loaded.")}
  },[reviewer,canRequest])
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
      const response=await fetch(apiPath(`/api/submission-extensions/${request.id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision,managerNote:notes[request.id]??"",approvedUntil:decision==="approved"?new Date(approvedUntil[request.id]||request.requestedUntil).toISOString():null})})
      const data=await response.json();if(!response.ok)throw new Error(data.error??"The decision could not be saved.")
      setMessage(`Request ${decision}.`);await load()
    }catch(cause){setError(cause instanceof Error?cause.message:"The decision could not be saved.")}
    finally{setBusy(false)}
  }

  const currentPeriods=periods
  const selectedPeriod=currentPeriods.find(period=>period.id===periodId)
  const requestBase=selectedPeriod?(requesterRole==="manager"?selectedPeriod.managerSubmissionDeadline??selectedPeriod.submissionDeadline:selectedPeriod.submissionDeadline):null
  const canRequestExtension=!!selectedPeriod&&!!requestBase&&extensionCap(selectedPeriod,requesterRole==="manager")>new Date(Math.max(Date.now(),Date.parse(requestBase)))
  return <WindowSurface title={reviewer?"Extension review":"Timesheet extensions"} onBack={onClose}>
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-3 py-2"><div><h2 className="text-sm font-semibold text-sky-950">{reviewer?"Assigned extension requests":"Deadline extension"}</h2><p className="text-xs text-slate-700">{reviewer?"Review only requests assigned to you; account managers handle manager requests.":"Request more time for an eligible timesheet."}</p></div><Button size="icon" variant="outline" title="Refresh requests" aria-label="Refresh requests" onClick={()=>void load()}><RefreshCw className="size-4"/></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
        {error&&<p role="alert" className="mb-3 border border-red-300 bg-red-50 p-2 text-sm text-red-900">{error}</p>}{message&&<p role="status" className="mb-3 border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">{message}</p>}
        {canRequest&&<form onSubmit={submit} className="mb-4 grid gap-2 border border-orange-200 bg-orange-50/50 p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-slate-800">Timesheet period<select required value={periodId} onChange={event=>{const next=event.target.value;setPeriodId(next);const selected=periods.find(period=>period.id===next);if(selected)setRequestedUntil(localDateTime(extensionCap(selected,requesterRole==="manager")))}} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"><option value="">Select period</option>{currentPeriods.map(period=><option key={period.id} value={period.id}>{period.name} · due {formatDate(requesterRole==="manager"?period.managerSubmissionDeadline??period.submissionDeadline:period.submissionDeadline)}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium text-slate-800">Requested deadline<input required type="datetime-local" min={selectedPeriod?localDateTime(new Date(Date.parse(requesterRole==="manager"?selectedPeriod.managerSubmissionDeadline??selectedPeriod.submissionDeadline:selectedPeriod.submissionDeadline)+60_000)):localDateTime(new Date(Date.now()+60_000))} max={selectedPeriod?localDateTime(extensionCap(selectedPeriod,requesterRole==="manager")):undefined} value={requestedUntil} onChange={event=>setRequestedUntil(event.target.value)} className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-800 sm:col-span-2">Reason<textarea required minLength={5} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Why do you need additional time?" className="min-h-16 rounded border border-slate-300 bg-white p-2 text-sm"/></label>
          <p className="text-xs text-slate-600 sm:col-span-2">The extension cannot move the next approval deadline. Your assigned reviewer may approve an earlier time, but never beyond the next workflow cutoff.{selectedPeriod&&` Request cap: ${formatDate(extensionCap(selectedPeriod).toISOString())}.`}</p>
          {!canRequestExtension&&selectedPeriod&&<p className="text-xs font-medium text-amber-900 sm:col-span-2">No extension window is available for this period.</p>}
          <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={busy||!canRequestExtension||reason.trim().length<5}>{busy?"Sending…":"Send request"}</Button>
        </form>}
        <div className="space-y-2">{requests.length===0?<p className="border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{reviewer?"No extension requests are assigned to you.":"You have no extension requests yet."}</p>:requests.map(request=><article key={request.id} className="border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"><div><h3 className="text-sm font-semibold">{reviewer?request.requesterName:"Your request"} · {request.periodName}</h3><p className="text-xs text-slate-600">Requested until {formatDate(request.requestedUntil)} · sent {formatDate(request.createdAt)}</p></div><span className={`border px-2 py-0.5 text-xs font-semibold capitalize ${request.status==="approved"?"border-emerald-300 bg-emerald-50 text-emerald-900":request.status==="denied"?"border-red-300 bg-red-50 text-red-900":"border-orange-300 bg-orange-50 text-orange-950"}`}>{request.status}</span></div>
          <p className="px-3 py-2 text-sm">{request.reason}</p>{request.status==="approved"&&request.approvedUntil&&<p className="px-3 pb-2 text-xs font-semibold text-emerald-900">Submit by {formatDate(request.approvedUntil)}</p>}{request.managerNote&&<p className="mx-3 mb-2 border-l-2 border-sky-400 bg-sky-50 px-2 py-1 text-xs text-sky-950">Manager: {request.managerNote}</p>}
          {reviewer&&request.status==="pending"&&<div className="grid gap-2 border-t border-slate-200 p-2 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(14rem,1fr)_auto_auto]"><label className="grid gap-1 text-xs font-medium">Approved deadline<input aria-label={`Approved deadline for ${request.requesterName}`} type="datetime-local" max={localDateTime(new Date(request.requestedUntil))} value={approvedUntil[request.id]??localDateTime(new Date(request.requestedUntil))} onChange={event=>setApprovedUntil(current=>({...current,[request.id]:event.target.value}))} className="h-8 min-w-0 rounded border border-slate-300 px-2 text-xs"/></label><label className="grid gap-1 text-xs font-medium">Decision reason<input aria-label={`Decision note for ${request.requesterName}`} required minLength={5} maxLength={500} value={notes[request.id]??""} onChange={event=>setNotes(previous=>({...previous,[request.id]:event.target.value}))} placeholder="Required for approve or deny" className="h-8 min-w-48 rounded border border-slate-300 px-2 text-sm"/></label><Button className="self-end" variant="outline" disabled={busy|| (notes[request.id]??"").trim().length<5} onClick={()=>void decide(request,"denied")}><X className="size-4"/>Deny</Button><Button className="self-end" disabled={busy||(notes[request.id]??"").trim().length<5} onClick={()=>void decide(request,"approved")}><Check className="size-4"/>Approve</Button></div>}
          {!reviewer&&request.status==="pending"&&<p className="flex items-center gap-1 px-3 pb-2 text-xs text-slate-600"><Clock3 className="size-3.5"/>Waiting for {request.assignedTo}</p>}
        </article>)}</div>
      </div>
    </section>
  </WindowSurface>
}
