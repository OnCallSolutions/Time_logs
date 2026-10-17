/**
 * Displays approved contractor and employee candidates with account-review snapshots.
 * Explicit confirmation is required for handoff; no payment command is exposed.
 * Queue state identifies stale source approvals for subsequent human review.
 */
"use client"
import { Fragment,useEffect,useState } from "react"
import { Eye, Sparkles } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import { BusinessAccountActions } from "./business-account-actions"
import { NoteInput } from "./note-input"
import type { AccountHandoff } from "@/lib/account-handoffs"
type Handoff=AccountHandoff

/**
 * Displays manager handoffs and permission-gated financial evidence controls.
 * @param props - Live administrator-granted handoff, review, and AI rights.
 * @returns JSX.Element containing grouped evidence and explicit review windows.
 */
export function BusinessAccounts({canSend,canReview=false,canAI=false,canAuthorize=false,canPreviewSamples=false,onManagePeriods}:{canSend:boolean;canReview?:boolean;canAI?:boolean;canAuthorize?:boolean;canPreviewSamples?:boolean;onManagePeriods?:()=>void}){
  const [data,setData]=useState<{candidates:TimeEntry[];assignees:{email:string}[];handoffs:Handoff[];managers?:{email:string}[]}>({candidates:[],assignees:[],handoffs:[]})
  const [selected,setSelected]=useState<string[]>([])
  const [ids,setIds]=useState<string[]>([]),[recipient,setRecipient]=useState("")
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(""),[result,setResult]=useState(""),[revision,setRevision]=useState(0)
  const [search,setSearch]=useState(""),[category,setCategory]=useState("all"),[manager,setManager]=useState("all"),[worker,setWorker]=useState("all"),[sort,setSort]=useState("newest"),[state,setState]=useState("all")
  const [detail,setDetail]=useState<Handoff|null>(null),[review,setReview]=useState<Handoff|null>(null),[outcome,setOutcome]=useState("needs_information"),[note,setNote]=useState("")
  const [aiOpen,setAiOpen]=useState(false),[report,setReport]=useState<{summary:string;recommendations:{handoffId:string;severity:string;reason:string}[]}|null>(null)
  const [samplesOpen,setSamplesOpen]=useState(false)
  const rows=data.handoffs.filter(row=>(category==="all"||(row.evidence.workerCategory??"contractor")===category)&&(manager==="all"||row.evidence.reviewedBy===manager)&&(worker==="all"||row.evidence.contractor===worker)&&(state==="all"||(state==="stale"?!row.current:row.review_state===state))&&`${row.evidence.contractor} ${row.evidence.project} ${row.evidence.reviewedBy}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.evidence.reviewedBy.localeCompare(b.evidence.reviewedBy)||(sort==="hours"?b.evidence.hours-a.evidence.hours:sort==="oldest"?a.evidence.date.localeCompare(b.evidence.date):b.evidence.date.localeCompare(a.evidence.date)))
  const managers=Array.from(new Set(data.handoffs.map(row=>row.evidence.reviewedBy))).sort()
  const workers=Array.from(new Set(data.handoffs.filter(row=>(manager==="all"||row.evidence.reviewedBy===manager)&&(category==="all"||(row.evidence.workerCategory??"contractor")===category)).map(row=>row.evidence.contractor))).sort()
  const managerGroups=Array.from(new Map(rows.map(row=>[row.evidence.reviewedBy,rows.filter(item=>item.evidence.reviewedBy===row.evidence.reviewedBy)])).entries())
  /**
   * Performs explicit account triage or advisory analysis, never fund release.
   * @param ai - Whether to request advice instead of saving a human review.
   * @returns Promise<void> after server validation and visible feedback.
   */
  async function accountAction(ai:boolean){
    setBusy(true);setError("")
    try{
      const response=await fetch(apiPath(ai?"/api/accounts/review":"/api/accounts"),{method:ai?"POST":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(ai?{ids:rows.filter(row=>row.current&&row.review_state!=="archived"&&row.review_state!=="payout_eligible").slice(0,50).map(row=>row.id)}:{id:review?.id,state:outcome,note,version:review?.review_version})})
      const value=await response.json();if(!response.ok)throw new Error(value.error)
      if(ai)setReport(value);else{setReview(null);setResult("Account review saved.");setRevision(previous=>previous+1)}
    }catch(error){setError(error instanceof Error?error.message:"Account review failed.")}finally{setBusy(false)}
  }
  useEffect(()=>{
    const controller=new AbortController();setError("")
    fetch(apiPath("/api/accounts"),{cache:"no-store",signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error);setData(value);setIds([]);setSelected([]);setReport(null)}).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[revision])
  /** @returns Promise<void> after confirmed handoff or a retryable failure. */
  async function handoff(){
    setBusy(true);setError("")
    try{const response=await fetch(apiPath("/api/accounts"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,recipient})});const value=await response.json();if(!response.ok)throw new Error(value.error);setResult(`${value.createdCount} new handoffs from ${value.requestedCount} selected entries.`);setConfirm(false);setIds([]);setRevision(previous=>previous+1)}
    catch(error){setError(error instanceof Error?error.message:"Handoff failed.")}finally{setBusy(false)}
  }
  const openReviews=data.handoffs.filter(row=>row.review_state==="pending"||row.review_state==="needs_information")
  const financeReady=data.handoffs.filter(row=>row.current&&(row.review_state==="ready_for_finance"||row.review_state==="payout_eligible"))
  const staleCount=data.handoffs.filter(row=>!row.current).length
  return <section aria-label="Final approval queue" className="flex min-h-0 min-w-0 flex-col gap-3 text-slate-950">
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-orange-200 bg-gradient-to-r from-orange-50 via-white to-sky-50 px-3 py-2">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-orange-950">Final hours and finance review</h2><p className="text-xs text-slate-600">After manager review, verify the evidence and record a human-confirmed decision. Finance eligibility is audited; payment execution is not enabled here.</p></div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{onManagePeriods&&<Button size="sm" variant="outline" onClick={onManagePeriods}>Timesheet periods</Button>}{canPreviewSamples&&<Button size="sm" variant="outline" help="Preview synthetic timesheet examples; nothing is saved." onClick={()=>setSamplesOpen(true)}>Sample preview</Button>}<Button size="sm" variant="outline" onClick={()=>setRevision(previous=>previous+1)}>Refresh queue</Button></div>
    </header>
    <div aria-label="Business queue summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="border-l-4 border-orange-500 bg-orange-50 px-3 py-2"><p className="text-[11px] text-orange-900">Awaiting final review</p><p className="text-lg font-semibold tabular-nums">{openReviews.length}</p></div>
      <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2"><p className="text-[11px] text-blue-900">All assigned</p><p className="text-lg font-semibold tabular-nums">{data.handoffs.length}</p></div>
      <div className="border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2"><p className="text-[11px] text-emerald-900">Cleared for finance</p><p className="text-lg font-semibold tabular-nums">{financeReady.length}</p></div>
      <div className="border-l-4 border-red-500 bg-red-50 px-3 py-2"><p className="text-[11px] text-red-900">Source changed</p><p className="text-lg font-semibold tabular-nums">{staleCount}</p></div>
    </div>
    {samplesOpen&&<WindowSurface title="Synthetic timesheet samples" onBack={()=>setSamplesOpen(false)}><section className="w-full overflow-auto bg-white p-4"><NoteInput previewOnly onParsed={()=>{}}/></section></WindowSurface>}
    {!confirm&&error&&<p role="alert" className="text-destructive">{error}</p>}{result&&<p role="status">{result}</p>}
    {canSend&&<><div className="flex flex-wrap gap-2"><label className="text-sm">Account manager<select className="ml-2 rounded-md border p-2" value={recipient} onChange={event=>setRecipient(event.target.value)}><option value="">Choose account manager</option>{data.assignees.map(actor=><option key={actor.email}>{actor.email}</option>)}</select></label><Button variant="outline" onClick={()=>setIds(data.candidates.slice(0,50).map(entry=>entry.id))}>Select all eligible (up to 50)</Button><Button disabled={!ids.length||!recipient} onClick={()=>setConfirm(true)}>Review handoff ({ids.length})</Button></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Select</th><th className="p-2">Contractor</th><th className="p-2">Date</th><th className="p-2">Approved hours</th></tr></thead><tbody>{data.candidates.map(entry=><tr key={entry.id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Hand off ${entry.contractor} ${entry.date}`} checked={ids.includes(entry.id)} disabled={!ids.includes(entry.id)&&ids.length>=50} onChange={event=>setIds(previous=>event.target.checked?[...previous,entry.id]:previous.filter(id=>id!==entry.id))}/></td><td className="p-2">{entry.contractor}</td><td className="p-2">{entry.date}</td><td className="p-2">{entry.hours}</td></tr>)}</tbody></table></div></>}
    <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-2">
      <input aria-label="Search account evidence" className="h-9 min-w-48 flex-1 rounded-md border border-sky-200 bg-white px-3 text-sm" placeholder="Search people, projects or reviewers" value={search} onChange={event=>setSearch(event.target.value)}/>
      <span className="shrink-0 text-xs text-slate-600">{rows.length} of {data.handoffs.length}</span>
      {canAI&&<Button size="sm" variant="outline" disabled={!rows.some(row=>row.current&&row.review_state!=="archived")} onClick={()=>{setError("");setReport(null);setAiOpen(true)}}><Sparkles className="size-4"/>AI review</Button>}
      <details className="relative">
        <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-blue-200 bg-blue-50 px-3 text-sm text-blue-950 hover:bg-blue-100 [&::-webkit-details-marker]:hidden">Filter and sort</summary>
        <div className="absolute right-0 z-20 mt-1 grid min-w-64 gap-2 rounded-md border border-sky-200 bg-white p-3 shadow-lg sm:grid-cols-2">
          <label className="grid gap-1 text-xs">Worker type<select aria-label="Category" className="h-9 rounded border border-sky-200 bg-white px-2 text-sm" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All worker types</option><option value="contractor">Contractor</option><option value="employee">Employee</option></select></label>
          <label className="grid gap-1 text-xs">Approved by<select aria-label="Approving reviewer" className="h-9 max-w-full rounded border border-blue-200 bg-white px-2 text-sm" value={manager} onChange={event=>{setManager(event.target.value);setWorker("all")}}><option value="all">All managers</option>{managers.map(email=><option key={email}>{email}</option>)}</select></label>
          <label className="grid gap-1 text-xs">Manager's people<select aria-label="Manager contractor filter" className="h-9 max-w-full rounded border border-sky-200 bg-white px-2 text-sm" value={worker} onChange={event=>setWorker(event.target.value)}><option value="all">All people</option>{workers.map(name=><option key={name}>{name}</option>)}</select></label>
          <label className="grid gap-1 text-xs">Queue status<select aria-label="Evidence state" className="h-9 rounded border border-orange-200 bg-white px-2 text-sm" value={state} onChange={event=>setState(event.target.value)}>{["all","pending","needs_information","ready_for_finance","returned_to_manager","returned_to_submitter","payout_eligible","archived","stale"].map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
          <label className="grid gap-1 text-xs">Sort by<select aria-label="Sort evidence" className="h-9 rounded border border-emerald-200 bg-white px-2 text-sm" value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="hours">Most hours</option></select></label>
        </div>
      </details>
    </div>
    {canReview&&<div className="flex flex-wrap items-center gap-2 border-y py-3"><Button variant="outline" onClick={()=>setSelected(rows.filter(row=>row.current&&!["archived","payout_eligible"].includes(row.review_state)).slice(0,100).map(row=>row.id))}>Select all actionable (up to 100)</Button><Button variant="ghost" disabled={!selected.length} onClick={()=>setSelected([])}>Clear selection</Button><BusinessAccountActions rows={rows.filter(row=>selected.includes(row.id))} managers={data.managers??[]} canAuthorize={canAuthorize} onComplete={()=>{setResult("Business-account action confirmed.");setRevision(value=>value+1)}}/></div>}
    <div className="flex flex-wrap gap-6 border-y py-3 text-sm"><span>{rows.length} records</span><span>{rows.reduce((sum,row)=>sum+Number(row.evidence.hours),0).toFixed(1)} hours</span><span className="text-orange-700">{rows.filter(row=>!row.current).length} changed sources</span></div>
    {rows.length>0&&<div className="min-h-0 overflow-auto rounded-md border border-sky-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 z-[1] bg-sky-50 text-sky-950"><tr>{[...(canReview?["Select"]:[]),"Person / project","Approved by","Work date","Hours","Queue status","Actions"].map(label=><th key={label} className="px-2.5 py-2 font-semibold">{label}</th>)}</tr></thead><tbody>{managerGroups.map(([managerName,groupRows])=><Fragment key={managerName}><tr className="border-y border-blue-200 bg-blue-50"><th colSpan={canReview?7:6} className="px-2.5 py-2 text-left font-semibold text-blue-950">Manager · {managerName}<span className="ml-2 font-normal text-blue-800">{groupRows.length} underlying timesheet{groupRows.length===1?"":"s"}</span></th></tr>{groupRows.map(row=><tr key={row.id} className="border-t border-slate-100 odd:bg-white even:bg-sky-50/30 hover:bg-orange-50">{canReview&&<td className="px-2.5 py-2"><input type="checkbox" aria-label={`Select account timesheet ${row.id}`} disabled={!row.current||["archived","payout_eligible"].includes(row.review_state)||(!selected.includes(row.id)&&selected.length>=100)} checked={selected.includes(row.id)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,row.id]:previous.filter(id=>id!==row.id))}/></td>}<td className="px-2.5 py-2"><span className="block font-medium">{row.evidence.contractor}</span><span className="text-slate-600">{row.evidence.project} · {row.evidence.workerCategory??"contractor"}</span></td><td className="max-w-40 break-all px-2.5 py-2 text-slate-600">{row.evidence.reviewedBy}</td><td className="whitespace-nowrap px-2.5 py-2">{row.evidence.date}</td><td className="px-2.5 py-2 tabular-nums">{row.evidence.hours}h</td><td className="px-2.5 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 capitalize ${row.current?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-red-200 bg-red-50 text-red-800"}`}>{row.review_state.replaceAll("_"," ")}</span>{!row.current&&<span className="ml-1 text-red-700">· source changed</span>}</td><td className="px-2.5 py-2"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label={`View ${row.evidence.contractor} evidence`} title="View evidence" onClick={()=>setDetail(row)}><Eye className="size-4"/></Button>{canReview&&<Button size="sm" variant="outline" disabled={!row.current||["payout_eligible","returned_to_manager","returned_to_submitter"].includes(row.review_state)} onClick={()=>{setError("");setNote("");setOutcome("needs_information");setReview(row)}}>Review</Button>}</div></td></tr>)}</Fragment>)}</tbody></table></div>}
    {!rows.length&&<p className="text-sm text-muted-foreground">No matching account evidence.</p>}
    {detail&&<WindowSurface title="Account evidence" onBack={()=>setDetail(null)}><section className="w-full overflow-auto bg-white p-4"><h2 className="font-semibold">{detail.evidence.contractor}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries({...detail.evidence,id:detail.id,entryId:detail.entry_id,assignedTo:detail.assigned_to,handedBy:detail.handed_by,createdAt:detail.created_at,state:detail.review_state,note:detail.review_note,version:detail.review_version,current:detail.current}).map(([key,value])=><div key={key}><dt className="text-sm text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{String(value??"")}</dd></div>)}</dl></section></WindowSurface>}
    {review&&<WindowSurface title="Account review" disabled={busy} onBack={()=>setReview(null)}><section className="flex min-h-0 w-full flex-col bg-white p-4"><div className="min-h-0 flex-1 overflow-auto space-y-4"><h2 className="font-semibold">{review.evidence.contractor} / {review.evidence.hours}h</h2><label className="block">Outcome<select className="ml-2 rounded border p-2" value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="pending">Pending</option><option value="needs_information">Needs information</option><option value="ready_for_finance" disabled={!review.current}>Ready for finance review</option><option value="archived">Archived</option></select></label><label className="block">Review note<textarea className="mt-2 w-full rounded border p-2" value={note} maxLength={500} onChange={event=>setNote(event.target.value)}/></label>{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="flex justify-end border-t pt-3"><Button disabled={busy||!note.trim()||(!review.current&&outcome==="ready_for_finance")} onClick={()=>accountAction(false)}>{busy?"Saving...":"Confirm review"}</Button></footer></section></WindowSurface>}
    {aiOpen&&<WindowSurface title="AI account review" disabled={busy} onBack={()=>setAiOpen(false)}><section className="flex min-h-0 w-full flex-col bg-white p-4"><div className="min-h-0 flex-1 overflow-auto space-y-3"><p>Advisory evidence review. No payments or review states are changed.</p>{report&&<><p>{report.summary}</p>{report.recommendations.map(item=><article className="border-b py-3" key={item.handoffId}><h3 className="font-semibold">{data.handoffs.find(row=>row.id===item.handoffId)?.evidence.contractor} / {item.severity}</h3><p>{item.reason}</p></article>)}</>}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="flex justify-end border-t pt-3"><Button disabled={busy} onClick={()=>accountAction(true)}>{busy?"Analyzing...":"Analyze visible evidence (up to 50)"}</Button></footer></section></WindowSurface>}
    {confirm&&<WindowSurface title="Confirm contractor handoff" disabled={busy} onBack={()=>setConfirm(false)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">Confirm contractor handoff</h2><p>{recipient}</p><div className="min-h-0 flex-1 overflow-auto py-4">{data.candidates.filter(entry=>ids.includes(entry.id)).map(entry=><p key={entry.id}>{entry.contractor} · {entry.date} · {entry.hours}h</p>)}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><Button disabled={busy} onClick={handoff}>{busy?"Assigning...":"Confirm handoff"}</Button></section></WindowSurface>}
  </section>
}
