/**
 * Displays approved contractor candidates and assigned account-review snapshots.
 * Explicit confirmation is required for handoff; no payment command is exposed.
 * Queue state identifies stale source approvals for subsequent human review.
 */
"use client"
import { useEffect,useState } from "react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"
type Handoff={id:string;assigned_to:string;current:boolean;evidence:{contractor:string;hours:number}}

/** @param props.canSend - Live administrator-granted handoff right. @returns JSX.Element containing candidate selection and assigned evidence. */
export function BusinessAccounts({canSend}:{canSend:boolean}){
  const [data,setData]=useState<{candidates:TimeEntry[];assignees:{email:string}[];handoffs:Handoff[]}>({candidates:[],assignees:[],handoffs:[]})
  const [ids,setIds]=useState<string[]>([]),[recipient,setRecipient]=useState("")
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(""),[result,setResult]=useState(""),[revision,setRevision]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();setError("")
    fetch(apiPath("/api/accounts"),{cache:"no-store",signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error);setData(value)}).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
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
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Contractor</th><th className="p-2">Hours</th><th className="p-2">Account manager</th><th className="p-2">Evidence state</th></tr></thead><tbody>{data.handoffs.map(row=><tr key={row.id} className="border-t"><td className="p-2">{row.evidence.contractor}</td><td className="p-2">{row.evidence.hours}</td><td className="p-2">{row.assigned_to}</td><td className="p-2">{row.current?"Awaiting financial review":"Source changed — review required"}</td></tr>)}</tbody></table></div>
    {confirm&&<WindowSurface title="Confirm contractor handoff" disabled={busy} onBack={()=>setConfirm(false)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">Confirm contractor handoff</h2><p>{recipient}</p><div className="min-h-0 flex-1 overflow-auto py-4">{data.candidates.filter(entry=>ids.includes(entry.id)).map(entry=><p key={entry.id}>{entry.contractor} · {entry.date} · {entry.hours}h</p>)}{error&&<p role="alert" className="text-destructive">{error}</p>}</div><Button disabled={busy} onClick={handoff}>{busy?"Assigning...":"Confirm handoff"}</Button></section></WindowSurface>}
  </section>
}
