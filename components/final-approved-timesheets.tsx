"use client"

import { useEffect,useMemo,useState } from "react"
import { Download,Printer,RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { TimesheetPeriod } from "@/lib/db"
import type { TimeEntry } from "@/lib/types"

type Batch={key:string;owner:string;person:string;period:TimesheetPeriod;manager:string;entries:TimeEntry[];reopenLocked:boolean}

/** Read/export view for account-manager-approved batches, with audited reopen-to-queue action. */
export function FinalApprovedTimesheets({entries,email,onUpdated}:{entries:TimeEntry[];email:string;onUpdated:(entry:TimeEntry)=>void}){
  const [periods,setPeriods]=useState<TimesheetPeriod[]>([])
  const [accountApprovedIds,setAccountApprovedIds]=useState<Set<string>|null>(null)
  const [query,setQuery]=useState("")
  const [periodFilter,setPeriodFilter]=useState("all")
  const [managerFilter,setManagerFilter]=useState("all")
  const [selected,setSelected]=useState<string[]>([])
  const [reason,setReason]=useState("")
  const [confirm,setConfirm]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [notice,setNotice]=useState("")

  useEffect(()=>{const controller=new AbortController();fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(response.ok)setPeriods(data.periods??[])}).catch(()=>{});fetch(apiPath("/api/timesheets/final-approved"),{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(response.ok)setAccountApprovedIds(new Set(data.entryIds??[]))}).catch(()=>{});return()=>controller.abort()},[])

  const approved=useMemo(()=>entries.filter(entry=>accountApprovedIds?.has(entry.id)&&entry.status==="approved"),[entries,accountApprovedIds])
  const batches=useMemo(()=>{
    const groups=new Map<string,Batch>()
    for(const entry of approved){
      const period=periods.find(item=>entry.date>=item.startDate&&entry.date<=item.endDate)
      if(!period)continue
      const owner=entry.ownerEmail?.toLowerCase()??entry.contractor.toLowerCase(),key=`${owner}:${period.id}`
      const batch=groups.get(key)??{key,owner,person:entry.contractor,period,manager:entry.reviewManagerEmail??"Unassigned",entries:[],reopenLocked:false}
      batch.entries.push(entry);batch.reopenLocked ||= Boolean(entry.payoutEligible);groups.set(key,batch)
    }
    return [...groups.values()].sort((a,b)=>b.period.startDate.localeCompare(a.period.startDate)||a.person.localeCompare(b.person))
  },[approved,periods])
  const filtered=batches.filter(batch=>(periodFilter==="all"||batch.period.id===periodFilter)&&(managerFilter==="all"||batch.manager===managerFilter)&&`${batch.person} ${batch.manager} ${batch.period.name} ${batch.period.startDate} ${batch.period.endDate} ${batch.entries.map(entry=>`${entry.project} ${entry.description}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selectedBatches=filtered.filter(batch=>selected.includes(batch.key))
  const visibleEntries=filtered.flatMap(batch=>batch.entries)
  const totalHours=visibleEntries.reduce((sum,entry)=>sum+Number(entry.hours),0)
  const managers=[...new Set(batches.map(batch=>batch.manager))].sort()

  function exportCsv(){
    const quote=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`
    const rows=[["Patron","Approving manager","Period","Period start","Period end","Work date","Project","Description","Hours"],...visibleEntries.map(entry=>{const batch=filtered.find(group=>group.entries.some(item=>item.id===entry.id))!;return [entry.contractor,batch.manager,batch.period.name,batch.period.startDate,batch.period.endDate,entry.date,entry.project,entry.description,entry.hours]})]
    const blob=new Blob([rows.map(row=>row.map(quote).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"})
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download="final-approved-timesheets.csv";anchor.click();URL.revokeObjectURL(url)
  }

  async function reopen(){
    if(!selectedBatches.length||!reason.trim()||busy)return
    setBusy(true);setError("")
    try{
      for(const batch of selectedBatches){
        const response=await fetch(apiPath("/api/timesheets/reopen-approval"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ownerEmail:batch.owner,periodId:batch.period.id,startDate:batch.period.startDate,endDate:batch.period.endDate,reason:reason.trim(),selection:batch.entries.map(entry=>({id:entry.id,revision:entry.revision}))})})
        const data=await response.json();if(!response.ok)throw new Error(data.error??`Could not reopen ${batch.person}'s timesheet.`)
        for(const entry of data.entries as TimeEntry[]){onUpdated(entry);setAccountApprovedIds(previous=>{const next=new Set(previous);next.delete(entry.id);return next})}
      }
      setSelected([]);setReason("");setConfirm(false);setNotice(`${selectedBatches.length} timesheet${selectedBatches.length===1?"":"s"} returned to the approval queue. They were not returned to patrons.`)
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not reopen the selected timesheets.")}
    finally{setBusy(false)}
  }

  return <section aria-label="Final approved timesheets" className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden bg-white p-2 text-slate-950 sm:p-3">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2"><div><h2 className="text-sm font-semibold text-emerald-950">Final approved timesheets</h2><p className="text-xs text-slate-700">Approved by you · view and export, or reopen a complete batch to the approval queue.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!visibleEntries.length} onClick={()=>window.print()}><Printer className="size-4"/>Print / PDF</Button><Button size="sm" variant="outline" disabled={!visibleEntries.length} onClick={exportCsv}><Download className="size-4"/>CSV</Button><Button size="sm" disabled={!selectedBatches.length} onClick={()=>{setError("");setReason("");setConfirm(true)}}><RotateCcw className="size-4"/>Reopen selected ({selectedBatches.length})</Button></div></header>
    <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(12rem,1fr)_12rem_12rem]"><input aria-label="Search final approved timesheets" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search patron, project, manager, or period" className="h-9 min-w-0 border border-slate-300 px-3 text-sm"/><select aria-label="Filter approved period" value={periodFilter} onChange={event=>setPeriodFilter(event.target.value)} className="h-9 border border-slate-300 px-2 text-sm"><option value="all">All periods</option>{periods.map(period=><option key={period.id} value={period.id}>{period.name} · {period.startDate} - {period.endDate}</option>)}</select><select aria-label="Filter approving manager" value={managerFilter} onChange={event=>setManagerFilter(event.target.value)} className="h-9 border border-slate-300 px-2 text-sm"><option value="all">All managers</option>{managers.map(manager=><option key={manager}>{manager}</option>)}</select></div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-y border-slate-200 py-1.5 text-xs"><span>{filtered.length} timesheets · {visibleEntries.length} entries · {totalHours.toFixed(2)} hours</span><span>Selecting a batch reopens all its entries</span></div>
    {notice&&<p role="status" className="shrink-0 text-sm text-emerald-800">{notice}</p>}{error&&!confirm&&<p role="alert" className="shrink-0 text-sm text-red-800">{error}</p>}
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain border border-slate-200"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 z-[1] bg-sky-50"><tr><th className="p-2">Batch</th><th className="p-2">Patron</th><th className="p-2">Approving manager</th><th className="p-2">Period</th><th className="p-2">Work date</th><th className="p-2">Project / work</th><th className="p-2">Hours</th></tr></thead><tbody>{filtered.flatMap(batch=>batch.entries.map((entry,index)=><tr key={entry.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60"><td className="p-2">{index===0&&<input type="checkbox" aria-label={`Select approved timesheet ${batch.person} ${batch.period.name}`} title={batch.reopenLocked?"Finance-cleared timesheets cannot be reopened to approvals":undefined} disabled={batch.reopenLocked} checked={selected.includes(batch.key)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,batch.key]:previous.filter(key=>key!==batch.key))}/>}</td><td className="p-2">{index===0?batch.person:""}</td><td className="p-2">{index===0?batch.manager:""}</td><td className="p-2">{index===0?<>{batch.period.name}<span className="block text-slate-500">{batch.period.startDate} - {batch.period.endDate}</span>{batch.reopenLocked&&<span className="block text-slate-500">Finance cleared · reopen locked</span>}</>:""}</td><td className="whitespace-nowrap p-2">{entry.date}</td><td className="p-2"><span className="font-medium">{entry.project}</span><span className="block text-slate-600">{entry.description}</span></td><td className="whitespace-nowrap p-2">{entry.hours}h</td></tr>))}</tbody></table>{accountApprovedIds===null?<p role="status" className="p-8 text-center text-sm text-slate-600">Loading final approvals…</p>:!filtered.length&&<p className="p-8 text-center text-sm text-slate-600">No account-manager-approved timesheets match this view.</p>}</div>
    {confirm&&<WindowSurface title="Reopen approved timesheets" disabled={busy} onBack={()=>setConfirm(false)}><section className="w-full space-y-3 bg-white p-4"><h3 className="font-semibold">Send {selectedBatches.length} complete timesheet{selectedBatches.length===1?"":"s"} back to approvals?</h3><ul className="max-h-48 list-disc overflow-auto pl-5 text-sm">{selectedBatches.map(batch=><li key={batch.key}>{batch.person} · {batch.period.name} · {batch.entries.length} entries · {batch.entries.reduce((sum,entry)=>sum+Number(entry.hours),0)}h</li>)}</ul><label className="grid gap-1 text-sm">Reason for reopening<textarea aria-label="Reopen reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} className="min-h-24 border border-slate-300 p-2"/></label><p className="text-xs text-slate-600">The timesheets return to the account-manager approval queue. Patrons are not notified and entries are not marked rejected.</p>{error&&<p role="alert" className="text-sm text-red-800">{error}</p>}<footer className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button><Button disabled={busy||reason.trim().length<5} onClick={()=>void reopen()}>{busy?"Reopening…":"Return to approval queue"}</Button></footer></section></WindowSurface>}
  </section>
}
