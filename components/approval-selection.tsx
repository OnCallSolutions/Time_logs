/**
 * Provides bounded single, selected, and all-visible operational review actions.
 * AI suggestions never mutate records; confirmed decisions use the existing API.
 * Each failed record remains visible so partial batches are not reported as complete.
 */
"use client"
import { useState } from "react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { EntryReviewDialog } from "./manager-workspace"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"

/**
 * Renders a selection queue and explicit confirmation or AI suggestions dialog.
 * @param props.entries - Submitted records already authorized by the server.
 * @param props.email - Current identity, excluded from self-review.
 * @param props.canReview - Current operational approval permission.
 * @param props.canAI - Current advisory AI permission.
 * @param props.onUpdated - Applies only confirmed server records to the workspace.
 * @returns JSX.Element containing the bounded review queue.
 */
export function ApprovalSelection({entries,email,canReview,canAI,onUpdated}:{entries:TimeEntry[];email:string;canReview:boolean;canAI:boolean;onUpdated:(entry:TimeEntry)=>void}) {
  const [ids,setIds]=useState<string[]>([])
  const [query,setQuery]=useState("")
  const [project,setProject]=useState("")
  const [sort,setSort]=useState("oldest")
  const [dialog,setDialog]=useState<"approve"|"ai"|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [suggestions,setSuggestions]=useState<{entryId:string;decision:string;reason:string}[]>([])
  const [rejection,setRejection]=useState<{entry:TimeEntry;reason:string}|null>(null)
  const allEligible=entries.filter(entry=>entry.status==="submitted"&&entry.ownerEmail?.toLowerCase()!==email.toLowerCase())
  const eligible=allEligible.filter(entry=>(!project||entry.project===project)&&`${entry.contractor} ${entry.project} ${entry.description}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==="hours"?b.hours-a.hours:sort==="newest"?b.date.localeCompare(a.date):a.date.localeCompare(b.date))
  const selected=allEligible.filter(entry=>ids.includes(entry.id)).slice(0,50)
  /** @returns Promise<void> after loading advisory suggestions for selected server records. */
  async function advise(){
    setBusy(true);setError("");setSuggestions([]);setDialog("ai")
    try{const response=await fetch(apiPath("/api/review"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:selected.map(entry=>entry.id)})});const data=await response.json();if(!response.ok)throw new Error(data.error);setSuggestions(data.recommendations)}
    catch(error){setError(error instanceof Error?error.message:"Review unavailable.")}finally{setBusy(false)}
  }
  /** @param records - Explicitly confirmed records. @returns Promise<void> after per-record server confirmation. */
  async function approve(records:TimeEntry[]){
    setBusy(true);setError("")
    try{for(const entry of records){const response=await fetch(apiPath(`/api/entries/${entry.id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"approved"})});const data=await response.json();if(!response.ok)throw new Error(`${entry.contractor}: ${data.error}`);onUpdated(data.entry);setIds(previous=>previous.filter(id=>id!==entry.id))}setDialog(null)}
    catch(error){setError(error instanceof Error?error.message:"Approval unavailable.")}finally{setBusy(false)}
  }
  /** @param note - Required human-confirmed rejection reason. @returns Promise<void> after scoped server mutation. */
  async function reject(note:string){
    if(!rejection||busy)return
    setBusy(true);setError("")
    try{const response=await fetch(apiPath(`/api/entries/${rejection.entry.id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"rejected",reviewNote:note})});const data=await response.json();if(!response.ok)throw new Error(data.error);onUpdated(data.entry);setRejection(null)}
    catch(error){setError(error instanceof Error?error.message:"Rejection unavailable.");setRejection(null)}finally{setBusy(false)}
  }
  return <section aria-label="Approval selection" className="space-y-3 border-y py-3">
    <div className="flex flex-wrap gap-2"><input aria-label="Search review queue" placeholder="Search contractor or project" value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 rounded-md border bg-white p-2 text-sm"/><select aria-label="Review project" value={project} onChange={event=>setProject(event.target.value)} className="max-w-full rounded-md border bg-white p-2 text-sm"><option value="">All projects</option>{[...new Set(allEligible.map(entry=>entry.project))].sort().map(name=><option key={name}>{name}</option>)}</select><select aria-label="Review order" value={sort} onChange={event=>setSort(event.target.value)} className="rounded-md border bg-white p-2 text-sm"><option value="oldest">Work date: oldest</option><option value="newest">Work date: newest</option><option value="hours">Hours: highest</option></select></div>
    <p className="text-xs text-muted-foreground">{eligible.length} visible · {allEligible.length} eligible · {selected.length} selected</p>
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Contractor and staff review</h2><Button variant="outline" size="sm" disabled={busy||!eligible.length} onClick={()=>setIds(eligible.slice(0,50).map(entry=>entry.id))}>Select all eligible (up to 50)</Button><Button variant="outline" size="sm" disabled={busy||!ids.length} onClick={()=>setIds([])}>Clear selection</Button>{canAI&&<Button size="sm" disabled={busy||!selected.length} onClick={advise}>AI suggestions</Button>}{canReview&&<Button size="sm" disabled={busy||!selected.length} onClick={()=>{setError("");setDialog("approve")}}>Review selected ({selected.length})</Button>}</div>
    <div className="max-h-[55dvh] overflow-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="sticky top-0 bg-orange-50"><tr><th className="p-2">Select</th><th className="p-2">Contractor / staff</th><th className="p-2">Project</th><th className="p-2">Date</th><th className="p-2">Hours</th></tr></thead><tbody>{eligible.map(entry=><tr key={entry.id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Select ${entry.contractor} ${entry.date}`} disabled={busy||(!ids.includes(entry.id)&&selected.length>=50)} checked={ids.includes(entry.id)} onChange={event=>setIds(previous=>event.target.checked?[...previous,entry.id]:previous.filter(id=>id!==entry.id))}/></td><td className="p-2">{entry.contractor}</td><td className="p-2">{entry.project}</td><td className="p-2">{entry.date}</td><td className="p-2 tabular-nums">{entry.hours}</td></tr>)}</tbody></table></div>
    {dialog&&<WindowSurface title={dialog==="ai"?"AI approval suggestions":"Confirm selected approvals"} disabled={busy} onBack={()=>setDialog(null)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">{dialog==="ai"?"AI approval suggestions":"Confirm selected approvals"}</h2><div className="min-h-0 flex-1 overflow-auto py-4">{busy&&<p role="status">Processing...</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}{dialog==="approve"?selected.map(entry=><p key={entry.id}>{entry.contractor} · {entry.date} · {entry.hours}h</p>):suggestions.map(item=><article key={item.entryId} className="border-b py-3"><p>{allEligible.find(entry=>entry.id===item.entryId)?.contractor}: {item.decision}</p><p className="text-sm">{item.reason}</p>{canReview&&item.decision==="approved"&&<Button disabled={busy} variant="outline" onClick={()=>{const entry=allEligible.find(entry=>entry.id===item.entryId);if(entry)void approve([entry])}}>Confirm this approval</Button>}{canReview&&item.decision!=="approved"&&<Button disabled={busy} variant="outline" onClick={()=>{const entry=allEligible.find(entry=>entry.id===item.entryId);if(entry)setRejection({entry,reason:item.reason})}}>Review rejection</Button>}</article>)}</div>{dialog==="approve"&&<Button disabled={busy||!selected.length||!canReview} onClick={()=>void approve(selected)}>Confirm {selected.length} approvals</Button>}</section></WindowSurface>}
    {rejection&&<EntryReviewDialog entry={rejection.entry} decision="rejected" initialNote={rejection.reason} onCancel={()=>{if(!busy)setRejection(null)}} onConfirm={note=>{if(canReview)void reject(note)}}/>}
  </section>
}
