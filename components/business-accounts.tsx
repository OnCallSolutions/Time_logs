/**
 * Displays approved contractor and employee candidates with account-review snapshots.
 * Explicit confirmation is required for handoff; no payment command is exposed.
 * Queue state identifies stale source approvals for subsequent human review.
 */
"use client"
import { useEffect,useState } from "react"
import { Eye, Sparkles } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
import type { AccountHandoff } from "@/lib/account-handoffs"
type Handoff=AccountHandoff

/**
 * Displays manager handoffs and permission-gated financial evidence controls.
 * @param props - Live administrator-granted handoff, review, and AI rights.
 * @returns JSX.Element containing grouped evidence and explicit review windows.
 */
export function BusinessAccounts({canSend,canReview=false,canAI=false}:{canSend:boolean;canReview?:boolean;canAI?:boolean}){
  const [data,setData]=useState<{candidates:TimeEntry[];assignees:{email:string}[];handoffs:Handoff[]}>({candidates:[],assignees:[],handoffs:[]})
  const [ids,setIds]=useState<string[]>([]),[recipient,setRecipient]=useState("")
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(""),[result,setResult]=useState(""),[revision,setRevision]=useState(0)
  const [search,setSearch]=useState(""),[category,setCategory]=useState("all"),[manager,setManager]=useState("all"),[sort,setSort]=useState("newest"),[state,setState]=useState("all")
  const [detail,setDetail]=useState<Handoff|null>(null),[review,setReview]=useState<Handoff|null>(null),[outcome,setOutcome]=useState("needs_information"),[note,setNote]=useState("")
  const [aiOpen,setAiOpen]=useState(false),[report,setReport]=useState<{summary:string;recommendations:{handoffId:string;severity:string;reason:string}[]}|null>(null)
  const rows=data.handoffs.filter(row=>(category==="all"||(row.evidence.workerCategory??"contractor")===category)&&(manager==="all"||row.evidence.reviewedBy===manager)&&(state==="all"||(state==="stale"?!row.current:row.review_state===state))&&`${row.evidence.contractor} ${row.evidence.project} ${row.evidence.reviewedBy}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==="hours"?b.evidence.hours-a.evidence.hours:sort==="oldest"?a.evidence.date.localeCompare(b.evidence.date):b.evidence.date.localeCompare(a.evidence.date))
  const managers=Array.from(new Set(data.handoffs.map(row=>row.evidence.reviewedBy))).sort()
  /**
   * Performs explicit account triage or advisory analysis, never fund release.
   * @param ai - Whether to request advice instead of saving a human review.
   * @returns Promise<void> after server validation and visible feedback.
   */
  async function accountAction(ai:boolean){
    setBusy(true);setError("")
    try{
      const response=await fetch(apiPath(ai?"/api/accounts/review":"/api/accounts"),{method:ai?"POST":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(ai?{ids:rows.filter(row=>row.current&&row.review_state!=="archived").slice(0,50).map(row=>row.id)}:{id:review?.id,state:outcome,note,version:review?.review_version})})
      const value=await response.json();if(!response.ok)throw new Error(value.error)
      if(ai)setReport(value);else{setReview(null);setResult("Account review saved.");setRevision(previous=>previous+1)}
    }catch(error){setError(error instanceof Error?error.message:"Account review failed.")}finally{setBusy(false)}
  }
  useEffect(()=>{
    const controller=new AbortController();setError("")
    fetch(apiPath("/api/accounts"),{cache:"no-store",signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error);setData(value);setIds([]);setReport(null)}).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[revision])
  /** @returns Promise<void> after confirmed handoff or a retryable failure. */
  async function handoff(){
    setBusy(true);setError("")
    try{const response=await fetch(apiPath("/api/accounts"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,recipient})});const value=await response.json();if(!response.ok)throw new Error(value.error);setResult(`${value.createdCount} new handoffs from ${value.requestedCount} selected entries.`);setConfirm(false);setIds([]);setRevision(previous=>previous+1)}
    catch(error){setError(error instanceof Error?error.message:"Handoff failed.")}finally{setBusy(false)}
  }
  return <section aria-label="Business accounts" className="space-y-3"><header className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Business accounts</h2><Button variant="outline" onClick={()=>setRevision(previous=>previous+1)}>Refresh queue</Button></header>
    {!confirm&&error&&<p role="alert" className="text-destructive">{error}</p>}{result&&<p role="status">{result}</p>}
    {canSend&&<><div className="flex flex-wrap gap-2"><label className="text-sm">Account manager<select className="ml-2 rounded-md border p-2" value={recipient} onChange={event=>setRecipient(event.target.value)}><option value="">Choose account manager</option>{data.assignees.map(actor=><option key={actor.email}>{actor.email}</option>)}</select></label><Button variant="outline" onClick={()=>setIds(data.candidates.slice(0,50).map(entry=>entry.id))}>Select all eligible (up to 50)</Button><Button disabled={!ids.length||!recipient} onClick={()=>setConfirm(true)}>Review handoff ({ids.length})</Button></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Select</th><th className="p-2">Contractor</th><th className="p-2">Date</th><th className="p-2">Approved hours</th></tr></thead><tbody>{data.candidates.map(entry=><tr key={entry.id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Hand off ${entry.contractor} ${entry.date}`} checked={ids.includes(entry.id)} disabled={!ids.includes(entry.id)&&ids.length>=50} onChange={event=>setIds(previous=>event.target.checked?[...previous,entry.id]:previous.filter(id=>id!==entry.id))}/></td><td className="p-2">{entry.contractor}</td><td className="p-2">{entry.date}</td><td className="p-2">{entry.hours}</td></tr>)}</tbody></table></div></>}
    <div className="flex flex-wrap gap-2"><input aria-label="Search account evidence" className="min-w-48 flex-1 rounded border p-2" placeholder="Search people, projects or reviewers" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Category" className="rounded border p-2" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All categories</option><option value="contractor">Contractors</option><option value="employee">Internal employees</option></select><select aria-label="Approving reviewer" className="max-w-full rounded border p-2" value={manager} onChange={event=>setManager(event.target.value)}><option value="all">All approving reviewers</option>{managers.map(email=><option key={email}>{email}</option>)}</select><select aria-label="Evidence state" className="rounded border p-2" value={state} onChange={event=>setState(event.target.value)}>{["all","pending","needs_information","ready_for_finance","archived","stale"].map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select><select aria-label="Sort evidence" className="rounded border p-2" value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="hours">Most hours</option></select>{canAI&&<Button variant="outline" disabled={!rows.some(row=>row.current&&row.review_state!=="archived")} onClick={()=>{setError("");setReport(null);setAiOpen(true)}}><Sparkles className="size-4"/>AI review</Button>}</div>
    <div className="flex flex-wrap gap-6 border-y py-3 text-sm"><span>{rows.length} records</span><span>{rows.reduce((sum,row)=>sum+Number(row.evidence.hours),0).toFixed(1)} hours</span><span className="text-orange-700">{rows.filter(row=>!row.current).length} changed sources</span></div>
    {Array.from(new Set(rows.map(row=>row.evidence.reviewedBy))).sort().map(group=><section key={group}><h3 className="bg-orange-50 p-2 text-sm font-semibold">Approving reviewer: {group}</h3><div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead><tr>{["Person","Category","Project / date","Hours","Account manager","Evidence state","Controls"].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{rows.filter(row=>row.evidence.reviewedBy===group).map(row=><tr key={row.id} className="border-t"><td className="p-2">{row.evidence.contractor}</td><td>{row.evidence.workerCategory??"contractor"}</td><td>{row.evidence.project}<br/>{row.evidence.date}</td><td>{row.evidence.hours}</td><td className="break-all">{row.assigned_to}</td><td className={row.current?"text-teal-700":"text-red-700"}>{row.current?row.review_state.replaceAll("_"," "):"Source changed"}</td><td><div className="flex gap-2"><Button variant="ghost" size="icon" aria-label={`View ${row.evidence.contractor} evidence`} title="View evidence" onClick={()=>setDetail(row)}><Eye className="size-4"/></Button>{canReview&&<Button variant="outline" onClick={()=>{setError("");setNote("");setOutcome("needs_information");setReview(row)}}>Review</Button>}</div></td></tr>)}</tbody></table></div></section>)}
    {!rows.length&&<p className="text-sm text-muted-foreground">No matching account evidence.</p>}
    {detail&&<WindowSurface title="Account evidence" onBack={()=>setDetail(null)}><section className="w-full overflow-auto bg-white p-4"><h2 className="font-semibold">{detail.evidence.contractor}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries({...detail.evidence,id:detail.id,entryId:detail.entry_id,assignedTo:detail.assigned_to,handedBy:detail.handed_by,createdAt:detail.created_at,state:detail.review_state,note:detail.review_note,version:detail.review_version,current:detail.current}).map(([key,value])=><div key={key}><dt className="text-sm text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{String(value??"")}</dd></div>)}</dl></section></WindowSurface>}
    {review&&<WindowSurface title="Account review" disabled={busy} onBack={()=>setReview(null)}><section className="flex min-h-0 w-full flex-col bg-white p-4"><div className="min-h-0 flex-1 overflow-auto space-y-4"><h2 className="font-semibold">{review.evidence.contractor} / {review.evidence.hours}h</h2><label className="block">Outcome<select className="ml-2 rounded border p-2" value={outcome} onChange={event=>setOutcome(event.target.value)}><option value="pending">Pending</option><option value="needs_information">Needs information</option><option value="ready_for_finance" disabled={!review.current}>Ready for finance review</option><option value="archived">Archived</option></select></label><label className="block">Review note<textarea className="mt-2 w-full rounded border p-2" value={note} maxLength={500} onChange={event=>setNote(event.target.value)}/></label>{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="flex justify-end border-t pt-3"><Button disabled={busy||!note.trim()||(!review.current&&outcome==="ready_for_finance")} onClick={()=>accountAction(false)}>{busy?"Saving...":"Confirm review"}</Button></footer></section></WindowSurface>}
    {aiOpen&&<WindowSurface title="AI account review" disabled={busy} onBack={()=>setAiOpen(false)}><section className="flex min-h-0 w-full flex-col bg-white p-4"><div className="min-h-0 flex-1 overflow-auto space-y-3"><p>Advisory evidence review. No payments or review states are changed.</p>{report&&<><p>{report.summary}</p>{report.recommendations.map(item=><article className="border-b py-3" key={item.handoffId}><h3 className="font-semibold">{data.handoffs.find(row=>row.id===item.handoffId)?.evidence.contractor} / {item.severity}</h3><p>{item.reason}</p></article>)}</>}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><footer className="flex justify-end border-t pt-3"><Button disabled={busy} onClick={()=>accountAction(true)}>{busy?"Analyzing...":"Analyze visible evidence (up to 50)"}</Button></footer></section></WindowSurface>}
    {confirm&&<WindowSurface title="Confirm contractor handoff" disabled={busy} onBack={()=>setConfirm(false)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">Confirm contractor handoff</h2><p>{recipient}</p><div className="min-h-0 flex-1 overflow-auto py-4">{data.candidates.filter(entry=>ids.includes(entry.id)).map(entry=><p key={entry.id}>{entry.contractor} · {entry.date} · {entry.hours}h</p>)}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><Button disabled={busy} onClick={handoff}>{busy?"Assigning...":"Confirm handoff"}</Button></section></WindowSurface>}
  </section>
}
