/**
 * Displays approved contractor and employee candidates with account-review snapshots.
 * Explicit confirmation is required for handoff; no payment command is exposed.
 * Queue state identifies stale source approvals for subsequent human review.
 */
"use client"
import { Fragment,useEffect,useState } from "react"
import { CalendarDays, Check, ChevronRight, Eye, Pencil, Sparkles, Users } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { DataExportMenu } from "./data-export-menu"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import { BusinessAccountActions } from "./business-account-actions"
import { NoteInput } from "./note-input"
import type { AccountHandoff } from "@/lib/account-handoffs"
type Handoff=AccountHandoff
type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string}

/**
 * Displays manager handoffs and permission-gated financial evidence controls.
 * @param props - Live administrator-granted handoff, review, and AI rights.
 * @returns JSX.Element containing grouped evidence and explicit review windows.
 */
export function BusinessAccounts({canSend,canReview=false,canAI=false,canAuthorize=false,canPreviewSamples=false,onManagePeriods,onManageProjects,onDataChanged}:{canSend:boolean;canReview?:boolean;canAI?:boolean;canAuthorize?:boolean;canPreviewSamples?:boolean;onManagePeriods?:()=>void;onManageProjects?:()=>void;onDataChanged?:()=>void}){
  const [data,setData]=useState<{candidates:TimeEntry[];assignees:{email:string}[];handoffs:Handoff[];managers?:{email:string;officialName?:string}[];periods?:Period[]}>({candidates:[],assignees:[],handoffs:[]})
  const [selected,setSelected]=useState<string[]>([])
  const [ids,setIds]=useState<string[]>([]),[recipient,setRecipient]=useState("")
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(""),[result,setResult]=useState(""),[revision,setRevision]=useState(0)
  const [search,setSearch]=useState(""),[category,setCategory]=useState("all"),[manager,setManager]=useState("all"),[worker,setWorker]=useState("all"),[sort,setSort]=useState("newest"),[state,setState]=useState("all")
  const [detail,setDetail]=useState<Handoff|null>(null),[review,setReview]=useState<Handoff|null>(null),[outcome,setOutcome]=useState("needs_information"),[note,setNote]=useState("")
  const [editing,setEditing]=useState<Handoff|null>(null),[editDraft,setEditDraft]=useState({project:"",date:"",hours:"",description:"",reason:""})
  const [aiOpen,setAiOpen]=useState(false),[report,setReport]=useState<{summary:string;recommendations:{handoffId:string;severity:string;reason:string}[]}|null>(null)
  const [samplesOpen,setSamplesOpen]=useState(false)
  const [periodSelection,setPeriodSelection]=useState("all")
  const today=new Date().toISOString().slice(0,10)
  const periods=[...(data.periods??[])].sort((a,b)=>b.startDate.localeCompare(a.startDate))
  const periodForDate=(date:string)=>periods.find(period=>date>=period.startDate&&date<=period.endDate)
  const timesheetKey=(row:Handoff)=>(row.evidence.ownerEmail?.toLowerCase()??row.evidence.contractor.toLowerCase())+":"+(periodForDate(row.evidence.date)?.id??"outside:"+row.evidence.date)
  const periodRows=data.handoffs.filter(row=>periodSelection==="all"||(periodSelection==="unassigned"?!periodForDate(row.evidence.date):periodForDate(row.evidence.date)?.id===periodSelection))
  const batchCount=(items:Handoff[])=>new Set(items.map(timesheetKey)).size
  const rowsForBatch=(row:Handoff)=>periodRows.filter(candidate=>timesheetKey(candidate)===timesheetKey(row))
  const isActionable=(row:Handoff)=>row.current&&["pending","needs_information","ready_for_finance","reopened_for_review"].includes(row.review_state)
  function toggleBatch(row:Handoff,checked:boolean){
    const batchIds=rowsForBatch(row).filter(isActionable).map(candidate=>candidate.id)
    setSelected(previous=>checked
      ?batchIds.length+previous.filter(id=>!batchIds.includes(id)).length<=100?[...new Set([...previous,...batchIds])]:previous
      :previous.filter(id=>!batchIds.includes(id)))
  }
  function selectBatches(source:Handoff[]){
    const keys=[...new Set(source.map(timesheetKey))]
    const next:string[]=[]
    for(const key of keys){
      const batchIds=periodRows.filter(row=>timesheetKey(row)===key&&isActionable(row)).map(row=>row.id)
      if(next.length+batchIds.length>100)break
      next.push(...batchIds)
    }
    setSelected(next)
  }
  const managerEmails=Array.from(new Set(periodRows.map(row=>row.evidence.reviewedBy))).sort((a,b)=>a.localeCompare(b))
  const managerLabel=(email:string)=>data.managers?.find(item=>item.email.toLowerCase()===email.toLowerCase())?.officialName||email
  const selectedManagerRows=manager==="all"?periodRows:periodRows.filter(row=>row.evidence.reviewedBy===manager)
  const rows=selectedManagerRows.filter(row=>(category==="all"||(row.evidence.workerCategory??"contractor")===category)&&(worker==="all"||row.evidence.contractor===worker)&&(state==="all"||(state==="stale"?!row.current:row.review_state===state))&&`${row.evidence.contractor} ${row.evidence.project} ${row.evidence.reviewedBy}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.evidence.reviewedBy.localeCompare(b.evidence.reviewedBy)||(sort==="hours"?b.evidence.hours-a.evidence.hours:sort==="oldest"?a.evidence.date.localeCompare(b.evidence.date):b.evidence.date.localeCompare(a.evidence.date)))
  const workers=Array.from(new Set(periodRows.filter(row=>(manager==="all"||row.evidence.reviewedBy===manager)&&(category==="all"||(row.evidence.workerCategory??"contractor")===category)).map(row=>row.evidence.contractor))).sort()
  const managerGroups=Array.from(new Map(rows.map(row=>[row.evidence.reviewedBy,rows.filter(item=>item.evidence.reviewedBy===row.evidence.reviewedBy)])).entries())
  const periodOptions=[...periods.map(period=>({id:period.id,label:period.name,range:`${period.startDate} – ${period.endDate}`,count:batchCount(data.handoffs.filter(row=>periodForDate(row.evidence.date)?.id===period.id))})),{id:"unassigned",label:"Outside periods",range:"Unassigned work dates",count:batchCount(data.handoffs.filter(row=>!periodForDate(row.evidence.date)))}]
  const selectedPeriod=periodOptions.find(period=>period.id===periodSelection)
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
      if(ai)setReport(value);else{setReview(null);setResult("Account review saved.");setRevision(previous=>previous+1);onDataChanged?.()}
    }catch(error){setError(error instanceof Error?error.message:"Account review failed.")}finally{setBusy(false)}
  }
  async function saveEntryCorrection(){
    if(!editing||!editDraft.reason.trim())return
    setBusy(true);setError("")
    try{
      const response=await fetch(apiPath("/api/accounts/correct-entry"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:editing.id,periodId:periodForDate(editing.evidence.date)?.id,revision:editing.source_updated_at,project:editDraft.project,date:editDraft.date,hours:Number(editDraft.hours),description:editDraft.description,reason:editDraft.reason})})
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Entry correction failed.")
      setEditing(null);setResult("Correction saved and audit logged. Review the complete batch before approving or returning it.");setRevision(current=>current+1);onDataChanged?.()
    }catch(error){setError(error instanceof Error?error.message:"Entry correction failed.")}finally{setBusy(false)}
  }
  useEffect(()=>{
    const controller=new AbortController();setError("")
    fetch(apiPath("/api/accounts"),{cache:"no-store",signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error);setData(value);setPeriodSelection(previous=>previous==="all"?value.periods?.find((period:Period)=>today>=period.startDate&&today<=period.endDate)?.id??value.periods?.[0]?.id??"all":previous);setManager("all");setWorker("all");setIds([]);setSelected([]);setReport(null)}).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[revision])
  /** @returns Promise<void> after confirmed handoff or a retryable failure. */
  async function handoff(){
    setBusy(true);setError("")
    try{const response=await fetch(apiPath("/api/accounts"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,recipient})});const value=await response.json();if(!response.ok)throw new Error(value.error);setResult(`${value.createdCount} new handoffs from ${value.requestedCount} selected entries.`);setConfirm(false);setIds([]);setRevision(previous=>previous+1)}
    catch(error){setError(error instanceof Error?error.message:"Handoff failed.")}finally{setBusy(false)}
  }
  const openReviews=periodRows.filter(row=>row.review_state==="pending"||row.review_state==="needs_information"||row.review_state==="reopened_for_review")
  const accountApproved=periodRows.filter(row=>row.current&&row.review_state==="account_approved")
  const financeReady=periodRows.filter(row=>row.current&&row.review_state==="payout_eligible")
  const staleCount=periodRows.filter(row=>!row.current).length
  return <section aria-label="Timesheet approvals" className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden text-slate-950">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-orange-200 bg-gradient-to-r from-orange-50 via-white to-sky-50 px-3 py-1.5">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-orange-950">Timesheet approvals</h2><p className="text-[11px] text-slate-600">Review complete manager-approved timesheets. Return corrections here or approve the batch.</p></div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">{onManageProjects&&<Button size="sm" variant="outline" help="Assign projects to contractors and employees." onClick={onManageProjects}>Projects</Button>}{onManagePeriods&&<Button size="sm" variant="outline" help="Configure timesheet periods and deadlines." onClick={onManagePeriods}>Periods</Button>}{canPreviewSamples&&<Button size="sm" variant="outline" help="Preview synthetic timesheet examples; nothing is saved." onClick={()=>setSamplesOpen(true)}>Samples</Button>}<Button size="sm" variant="outline" help="Reload approved timesheet records." onClick={()=>setRevision(previous=>previous+1)}>Refresh</Button></div>
    </header>
    <div aria-label="Business queue summary" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 pb-1 text-[11px]"><span className="text-orange-800">Awaiting <strong className="tabular-nums">{openReviews.length}</strong></span><span className="text-emerald-800">Account approved <strong className="tabular-nums">{accountApproved.length}</strong></span><span className="text-blue-800">Payout eligible <strong className="tabular-nums">{financeReady.length}</strong></span><span className="text-red-800">Changed <strong className="tabular-nums">{staleCount}</strong></span></div>
    {samplesOpen&&<WindowSurface title="Synthetic timesheet samples" onBack={()=>setSamplesOpen(false)}><section className="w-full overflow-auto bg-white p-4"><NoteInput previewOnly onParsed={()=>{}}/></section></WindowSurface>}
    {!confirm&&error&&<p role="alert" className="shrink-0 text-xs text-destructive">{error}</p>}{result&&<p role="status" className="shrink-0 text-xs">{result}</p>}
    {canSend&&<><div className="flex flex-wrap gap-2"><label className="text-sm">Account manager<select className="ml-2 rounded-md border p-2" value={recipient} onChange={event=>setRecipient(event.target.value)}><option value="">Choose account manager</option>{data.assignees.map(actor=><option key={actor.email}>{actor.email}</option>)}</select></label><Button variant="outline" onClick={()=>setIds(data.candidates.slice(0,50).map(entry=>entry.id))}>Select all eligible (up to 50)</Button><Button disabled={!ids.length||!recipient} onClick={()=>setConfirm(true)}>Review handoff ({ids.length})</Button></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Select</th><th className="p-2">Contractor</th><th className="p-2">Date</th><th className="p-2">Approved hours</th></tr></thead><tbody>{data.candidates.map(entry=><tr key={entry.id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Hand off ${entry.contractor} ${entry.date}`} checked={ids.includes(entry.id)} disabled={!ids.includes(entry.id)&&ids.length>=50} onChange={event=>setIds(previous=>event.target.checked?[...previous,entry.id]:previous.filter(id=>id!==entry.id))}/></td><td className="p-2">{entry.contractor}</td><td className="p-2">{entry.date}</td><td className="p-2">{entry.hours}</td></tr>)}</tbody></table></div></>}
    <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 border-y border-sky-200 py-2 lg:grid-cols-[180px_190px_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Timesheet periods" className="flex min-h-0 min-w-0 flex-col border-r border-sky-100 pr-2">
        <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase text-sky-950"><CalendarDays className="size-3.5"/>Periods</h3>
        <div className="flex min-h-0 max-h-36 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain lg:max-h-none">
          <button type="button" aria-pressed={periodSelection==="all"} onClick={()=>{setPeriodSelection("all");setManager("all");setSelected([])}} className={`flex items-center justify-between rounded-md px-2 py-2 text-left text-xs ${periodSelection==="all"?"bg-sky-100 font-semibold text-sky-950":"hover:bg-sky-50"}`}><span>All periods</span><span className="tabular-nums">{data.handoffs.length}</span></button>
          {periodOptions.map(period=><button key={period.id} type="button" aria-pressed={periodSelection===period.id} onClick={()=>{setPeriodSelection(period.id);setManager("all");setSelected([])}} className={`rounded-md border-l-2 px-2 py-2 text-left ${periodSelection===period.id?"border-orange-500 bg-orange-50 text-orange-950":"border-transparent hover:bg-sky-50"}`}><span className="flex items-center justify-between gap-2 text-xs font-semibold"><span className="truncate">{period.label}</span><span className="tabular-nums">{period.count}</span></span><span className="mt-0.5 block text-[10px] text-slate-600">{period.range}</span></button>)}
          {!periodOptions.length&&<p className="px-2 py-2 text-xs text-slate-500">No configured periods. Showing all assigned timesheets.</p>}
        </div>
      </nav>
      <nav aria-label="Managers in selected period" className="flex min-h-0 min-w-0 flex-col border-r border-blue-100 pr-2">
        <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase text-blue-950"><Users className="size-3.5"/>Managers</h3>
        <div className="flex min-h-0 max-h-36 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain lg:max-h-none">
          <button type="button" aria-pressed={manager==="all"} onClick={()=>{setManager("all");setWorker("all")}} className={`flex items-center justify-between rounded-md px-2 py-2 text-left text-xs ${manager==="all"?"bg-blue-100 font-semibold text-blue-950":"hover:bg-blue-50"}`}><span>All managers</span><span className="tabular-nums">{periodRows.length}</span></button>
          {managerEmails.map(email=>{const managerRows=periodRows.filter(row=>row.evidence.reviewedBy===email);const actionable=managerRows.filter(isActionable);const fullySelected=actionable.length>0&&actionable.every(row=>selected.includes(row.id));return <div key={email} className={`flex items-center gap-1 rounded-md border-l-2 ${manager===email?"border-blue-500 bg-blue-50":"border-transparent hover:bg-sky-50"}`}>
            {canReview&&<input type="checkbox" aria-label={`Select manager ${managerLabel(email)}`} checked={fullySelected} disabled={!actionable.length} onChange={event=>{const keys=new Set(actionable.map(timesheetKey));if(event.target.checked){const batchIds=periodRows.filter(row=>keys.has(timesheetKey(row))&&isActionable(row)).map(row=>row.id);setSelected(previous=>[...new Set([...previous,...batchIds])].length<=100?[...new Set([...previous,...batchIds])]:previous)}else setSelected(previous=>previous.filter(id=>!periodRows.some(row=>row.id===id&&keys.has(timesheetKey(row)))))}}/>}
            <button type="button" aria-pressed={manager===email} onClick={()=>{setManager(email);setWorker("all")}} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 text-left"><span className="truncate text-xs font-medium">{managerLabel(email)}</span><span className="shrink-0 text-[10px] tabular-nums text-slate-600">{managerRows.length}</span></button>
          </div>})}
          {!managerEmails.length&&<p className="px-2 py-2 text-xs text-slate-500">No manager timesheets in this period.</p>}
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-blue-950">{manager==="all"?"Period timesheets":managerLabel(manager)}</h3><p className="text-xs text-slate-600">{selectedPeriod?.label??"All configured periods"}{selectedPeriod?` · ${selectedPeriod.range}`:""} · {rows.length} timesheets</p></div>
        {canReview&&<div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" help="Select complete timesheets containing visible entries. Other entries in those batches are included." disabled={!rows.some(isActionable)} onClick={()=>selectBatches(rows)}>Select batches</Button><Button size="sm" variant="ghost" help="Clear the batch selection." disabled={!selected.length} onClick={()=>setSelected([])}>Clear</Button><BusinessAccountActions rows={periodRows.filter(row=>selected.includes(row.id))} managers={data.managers??[]} periods={periods} canAuthorize={canAuthorize} onComplete={()=>{setResult("Business-account action confirmed.");setRevision(value=>value+1);onDataChanged?.()}}/></div>}
      </div>
    <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-2">
      <input aria-label="Search account evidence" className="h-8 min-w-48 flex-1 rounded-md border border-sky-200 bg-white px-3 text-sm" placeholder="Search people, projects, manager" value={search} onChange={event=>setSearch(event.target.value)}/>
      <span className="shrink-0 text-xs text-slate-600">{rows.length} of {periodRows.length}</span>
      {canAI&&<Button size="sm" variant="outline" disabled={!rows.some(row=>row.current&&row.review_state!=="archived")} onClick={()=>{setError("");setReport(null);setAiOpen(true)}}><Sparkles className="size-4"/>AI review</Button>}
      <details className="relative">
        <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-blue-200 bg-blue-50 px-3 text-sm text-blue-950 hover:bg-blue-100 [&::-webkit-details-marker]:hidden">Filter and sort</summary>
        <div className="absolute right-0 z-20 mt-1 grid min-w-64 gap-2 rounded-md border border-sky-200 bg-white p-3 shadow-lg sm:grid-cols-2">
          <label className="grid gap-1 text-xs">Worker type<select aria-label="Category" className="h-9 rounded border border-sky-200 bg-white px-2 text-sm" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All worker types</option><option value="contractor">Contractor</option><option value="employee">Employee</option></select></label>
          <label className="grid gap-1 text-xs">Manager's people<select aria-label="Manager contractor filter" className="h-9 max-w-full rounded border border-sky-200 bg-white px-2 text-sm" value={worker} onChange={event=>setWorker(event.target.value)}><option value="all">All people</option>{workers.map(name=><option key={name}>{name}</option>)}</select></label>
          <label className="grid gap-1 text-xs">Queue status<select aria-label="Evidence state" className="h-9 rounded border border-orange-200 bg-white px-2 text-sm" value={state} onChange={event=>setState(event.target.value)}>{["all","pending","needs_information","reopened_for_review","ready_for_finance","account_approved","returned_to_manager","returned_to_submitter","payout_eligible","archived","stale"].map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
          <label className="grid gap-1 text-xs">Sort by<select aria-label="Sort evidence" className="h-9 rounded border border-emerald-200 bg-white px-2 text-sm" value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="hours">Most hours</option></select></label>
        </div>
      </details>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-1.5 text-[11px]"><div className="flex flex-wrap gap-3"><span>{rows.length} entries · {batchCount(rows)} batches</span><span>{rows.reduce((sum,row)=>sum+Number(row.evidence.hours),0).toFixed(1)}h</span><span className="text-orange-700">{rows.filter(row=>!row.current).length} changed</span></div><DataExportMenu title="Account review" filename="account-timesheet-review" rows={rows.map(row=>({patron:row.evidence.contractor,workerCategory:row.evidence.workerCategory??"contractor",project:row.evidence.project,approvingManager:managerLabel(row.evidence.reviewedBy),workDate:row.evidence.date,hours:Number(row.evidence.hours),reviewState:row.review_state,sourceCurrent:row.current,description:row.evidence.description,reviewNote:row.review_note??""}))} summary={{period:selectedPeriod?.label??"All periods",manager:manager==="all"?"All managers":managerLabel(manager),entries:rows.length,batches:batchCount(rows),hours:Number(rows.reduce((sum,row)=>sum+Number(row.evidence.hours),0).toFixed(2))}}/></div>
    {rows.length>0&&<div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-sky-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 z-[1] bg-sky-50 text-sky-950"><tr>{[...(canReview?["Select batch"]:[]),"Employee / contractor · project","Approving manager","Work date","Approved hours","Account review","Actions"].map(label=><th key={label} className="px-2.5 py-2 font-semibold">{label}</th>)}</tr></thead><tbody>{managerGroups.map(([managerName,groupRows])=><Fragment key={managerName}><tr className="border-y border-blue-200 bg-blue-50"><th colSpan={canReview?7:6} className="px-2.5 py-2 text-left font-semibold text-blue-950">{managerLabel(managerName)}<span className="ml-2 font-normal text-blue-800">{batchCount(groupRows)} batches</span></th></tr>{groupRows.map(row=><tr key={row.id} className="border-t border-slate-100 odd:bg-white even:bg-sky-50/30 hover:bg-orange-50">{canReview&&<td className="px-2.5 py-2"><input type="checkbox" aria-label={`Select account timesheet ${row.id}`} disabled={!isActionable(row)||(!selected.includes(row.id)&&selected.length>=100)} checked={selected.includes(row.id)} onChange={event=>toggleBatch(row,event.target.checked)}/></td>}<td className="px-2.5 py-2"><span className="block font-medium">{row.evidence.contractor}</span><span className="text-slate-600">{row.evidence.project} · <span className="capitalize">{row.evidence.workerCategory??"contractor"}</span></span></td><td className="max-w-40 px-2.5 py-2"><span className="block truncate" title={managerLabel(row.evidence.reviewedBy)}>{managerLabel(row.evidence.reviewedBy)}</span><span className="block break-all text-[10px] text-slate-500">{row.evidence.reviewedBy}</span></td><td className="whitespace-nowrap px-2.5 py-2">{row.evidence.date}</td><td className="px-2.5 py-2 tabular-nums font-medium">{row.evidence.hours}h</td><td className="px-2.5 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 capitalize ${row.current?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-red-200 bg-red-50 text-red-800"}`}>{row.review_state.replaceAll("_"," ")}</span>{!row.current&&<span className="ml-1 text-red-700">· source changed</span>}</td><td className="px-2.5 py-2"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label={`View ${row.evidence.contractor} evidence`} title="View evidence" onClick={()=>setDetail(row)}><Eye className="size-4"/></Button>{canReview&&row.review_state==="reopened_for_review"&&<Button size="sm" variant="outline" title="Correct this entry before approving or returning the recalled timesheet." disabled={!row.current} onClick={()=>{setEditDraft({project:row.evidence.project,date:row.evidence.date,hours:String(row.evidence.hours),description:row.evidence.description,reason:""});setEditing(row);setError("")}}><Pencil className="size-3.5"/>Correct</Button>}{canReview&&<Button size="sm" variant="outline" title="Update account triage only after final timesheet approval." disabled={!row.current||["account_approved","reopened_for_review","payout_eligible","returned_to_manager","returned_to_submitter"].includes(row.review_state)} onClick={()=>{setError("");setNote("");setOutcome("needs_information");setReview(row)}}>Triage</Button>}</div></td></tr>)}</Fragment>)}</tbody></table></div>}
    {!rows.length&&<p className="border border-dashed border-sky-200 bg-sky-50/40 px-4 py-8 text-center text-sm text-slate-600">{periodRows.length?"No timesheets match these review filters.":"No approved manager timesheets in this period yet."}</p>}
      </div>
    </div>
    <div className="approved-timesheets-print" aria-hidden="true">
      <h1>Approved timesheets</h1>
      <p>{selectedPeriod?.label??"All periods"}{selectedPeriod?` · ${selectedPeriod.range}`:""} · {manager==="all"?"All managers":managerLabel(manager)}</p>
      <p>{rows.length} timesheets · {rows.reduce((sum,row)=>sum+Number(row.evidence.hours),0).toFixed(2)} approved hours</p>
      <table><thead><tr><th>Employee / contractor</th><th>Project</th><th>Approving manager</th><th>Work date</th><th>Approved hours</th><th>Account review</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.evidence.contractor} ({row.evidence.workerCategory??"contractor"})</td><td>{row.evidence.project}</td><td>{managerLabel(row.evidence.reviewedBy)}<br/>{row.evidence.reviewedBy}</td><td>{row.evidence.date}</td><td>{row.evidence.hours}</td><td>{row.review_state.replaceAll("_"," ")}{!row.current?" · source changed":""}</td></tr>)}</tbody></table>
      <p className="print-generated">Tanovo Time · manager-approved evidence snapshot</p>
    </div>
    {editing&&<WindowSurface title={`Correct recalled timesheet · ${editing.evidence.contractor}`} disabled={busy} onBack={()=>setEditing(null)}><section className="w-full space-y-3 overflow-auto bg-white p-4"><p className="text-sm text-slate-700">This entry was recalled from final approval. Corrections are audited and remain in the same timesheet period.</p><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Project<input value={editDraft.project} maxLength={200} onChange={event=>setEditDraft(value=>({...value,project:event.target.value}))} className="h-9 rounded border px-2"/></label><label className="grid gap-1 text-sm">Work date<input type="date" min={periodForDate(editing.evidence.date)?.startDate} max={periodForDate(editing.evidence.date)?.endDate} value={editDraft.date} onChange={event=>setEditDraft(value=>({...value,date:event.target.value}))} className="h-9 rounded border px-2"/></label><label className="grid gap-1 text-sm">Hours<input type="number" min="0.01" max="24" step="0.25" value={editDraft.hours} onChange={event=>setEditDraft(value=>({...value,hours:event.target.value}))} className="h-9 rounded border px-2"/></label><label className="grid gap-1 text-sm sm:col-span-2">Work description<textarea value={editDraft.description} maxLength={2000} onChange={event=>setEditDraft(value=>({...value,description:event.target.value}))} className="min-h-20 rounded border p-2"/></label><label className="grid gap-1 text-sm sm:col-span-2">Correction reason<textarea aria-label="Correction reason" value={editDraft.reason} minLength={5} maxLength={500} onChange={event=>setEditDraft(value=>({...value,reason:event.target.value}))} className="min-h-16 rounded border p-2"/></label></div>{error&&<p role="alert" className="text-sm text-red-800">{error}</p>}<footer className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={()=>setEditing(null)}>Cancel</Button><Button disabled={busy||editDraft.reason.trim().length<5||!editDraft.project.trim()||!editDraft.description.trim()||!Number(editDraft.hours)} onClick={()=>void saveEntryCorrection()}>{busy?"Saving…":"Save correction"}</Button></footer></section></WindowSurface>}
    {detail&&<WindowSurface title="Account evidence" onBack={()=>setDetail(null)}><section className="w-full overflow-auto bg-white p-4"><h2 className="font-semibold">{detail.evidence.contractor}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries({...detail.evidence,id:detail.id,entryId:detail.entry_id,assignedTo:detail.assigned_to,handedBy:detail.handed_by,createdAt:detail.created_at,state:detail.review_state,note:detail.review_note,version:detail.review_version,current:detail.current}).map(([key,value])=><div key={key}><dt className="text-sm text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{String(value??"")}</dd></div>)}</dl></section></WindowSurface>}
    {review&&<WindowSurface title="Account review" disabled={busy} onBack={()=>setReview(null)}><section className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto bg-white p-4"><div className="space-y-4"><h2 className="font-semibold">{review.evidence.contractor} / {review.evidence.hours}h</h2><label className="block">Outcome<select className="ml-2 rounded border p-2" value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="pending">Pending</option><option value="needs_information">Needs information</option><option value="ready_for_finance" disabled={!review.current}>Ready for finance review</option><option value="archived">Archived</option></select></label><label className="block">Review note<textarea className="mt-2 w-full rounded border p-2" value={note} maxLength={500} onChange={event=>setNote(event.target.value)}/></label>{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="mt-3 flex justify-end border-t pt-3"><Button disabled={busy||!note.trim()||(!review.current&&outcome==="ready_for_finance")} onClick={()=>accountAction(false)}>{busy?"Saving...":"Confirm review"}</Button></footer></section></WindowSurface>}
    {aiOpen&&<WindowSurface title="AI account review" disabled={busy} onBack={()=>setAiOpen(false)}><section className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto bg-white p-4"><div className="space-y-3"><p>Advisory evidence review. No payments or review states are changed.</p>{report&&<><p>{report.summary}</p>{report.recommendations.map(item=><article className="border-b py-3" key={item.handoffId}><h3 className="font-semibold">{data.handoffs.find(row=>row.id===item.handoffId)?.evidence.contractor} / {item.severity}</h3><p>{item.reason}</p></article>)}</>}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="mt-3 flex justify-end border-t pt-3"><Button disabled={busy} onClick={()=>accountAction(true)}>{busy?"Analyzing...":"Analyze visible evidence (up to 50)"}</Button></footer></section></WindowSurface>}
    {confirm&&<WindowSurface title="Confirm contractor handoff" disabled={busy} onBack={()=>setConfirm(false)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">Confirm contractor handoff</h2><p>{recipient}</p><div className="min-h-0 flex-1 overflow-auto py-4">{data.candidates.filter(entry=>ids.includes(entry.id)).map(entry=><p key={entry.id}>{entry.contractor} · {entry.date} · {entry.hours}h</p>)}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><Button disabled={busy} onClick={handoff}>{busy?"Assigning...":"Confirm handoff"}</Button></section></WindowSurface>}
  </section>
}
