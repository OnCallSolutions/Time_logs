/** Human-confirmed timesheet-level review queue. */
"use client"
import { useEffect,useRef,useState } from "react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import type { TimeEntry } from "@/lib/types"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline?:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string}
type Timesheet={key:string;owner:string;person:string;period:Period;entries:TimeEntry[]}

export function ApprovalSelection({entries,email,canReview,canAI,allowSelfApproval=false,finalApprover=false,onUpdated}:{entries:TimeEntry[];email:string;canReview:boolean;canAI:boolean;allowSelfApproval?:boolean;finalApprover?:boolean;onUpdated:(entry:TimeEntry)=>void}) {
  const [selectedKeys,setSelectedKeys]=useState<string[]>([])
  const [query,setQuery]=useState("")
  const [project,setProject]=useState("")
  const [sort,setSort]=useState("oldest")
  const [dialog,setDialog]=useState<"approve"|"reject"|"ai"|null>(null)
  const [snapshot,setSnapshot]=useState<TimeEntry[]>([])
  const [note,setNote]=useState("")
  const [correctionDueAt,setCorrectionDueAt]=useState("")
  const [rejectedEntryId,setRejectedEntryId]=useState("")
  const [feedback,setFeedback]=useState("")
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [suggestions,setSuggestions]=useState<{entryId:string;decision:string;reason:string;revision?:string}[]>([])
  const [periods,setPeriods]=useState<Period[]>([])
  const [filtersRestored,setFiltersRestored]=useState(false)
  const operation=useRef(false)
  const filterStorageKey=`timesheet-review-filters:${email.toLowerCase()}`

  useEffect(()=>{const controller=new AbortController();fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(response.ok)setPeriods(data.periods??[])}).catch(()=>{});return()=>controller.abort()},[])
  useEffect(()=>{
    try{
      const saved=JSON.parse(sessionStorage.getItem(filterStorageKey)??"null") as {query?:unknown;project?:unknown;sort?:unknown}|null
      if(typeof saved?.query==="string")setQuery(saved.query)
      if(typeof saved?.project==="string")setProject(saved.project)
      if(saved?.sort==="oldest"||saved?.sort==="newest"||saved?.sort==="hours")setSort(saved.sort)
    }catch{}
    setFiltersRestored(true)
  },[filterStorageKey])
  useEffect(()=>{
    if(filtersRestored){
      try{sessionStorage.setItem(filterStorageKey,JSON.stringify({query,project,sort}))}catch{}
    }
  },[filterStorageKey,filtersRestored,project,query,sort])

  const allEligible=entries.filter(entry=>entry.status==="submitted"&&entry.reviewEligible!==false&&(allowSelfApproval||entry.ownerEmail?.toLowerCase()!==email.toLowerCase()))
  const periodFor=(entry:TimeEntry):Period=>periods.find(period=>entry.date>=period.startDate&&entry.date<=period.endDate)??{id:`month-${entry.date.slice(0,7)}`,name:new Date(`${entry.date.slice(0,7)}-01T00:00:00`).toLocaleDateString(undefined,{month:"long",year:"numeric"}),startDate:`${entry.date.slice(0,7)}-01`,endDate:entry.date.slice(0,10)}
  const allGroups=(()=>{
    const groups=new Map<string,Timesheet>()
    for(const entry of allEligible){const period=periodFor(entry);const owner=entry.ownerEmail?.toLowerCase()??entry.contractor.toLowerCase();const key=`${owner}:${period.id}`;const group=groups.get(key)??{key,owner,person:entry.contractor,period,entries:[]};group.entries.push(entry);groups.set(key,group)}
    return [...groups.values()].map(group=>({...group,entries:group.entries.sort((a,b)=>a.date.localeCompare(b.date)||a.project.localeCompare(b.project))}))
  })()
  const visibleGroups=allGroups.filter(group=>(!project||group.entries.some(entry=>entry.project===project))&&group.entries.some(entry=>`${entry.contractor} ${entry.project} ${entry.description}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>sort==="hours"?b.entries.reduce((sum,entry)=>sum+entry.hours,0)-a.entries.reduce((sum,entry)=>sum+entry.hours,0):sort==="newest"?b.period.startDate.localeCompare(a.period.startDate):a.period.startDate.localeCompare(b.period.startDate))
  const selectedGroups=allGroups.filter(group=>selectedKeys.includes(group.key))
  const selectedEntries=selectedGroups.flatMap(group=>group.entries)
  const snapshotHasOwn=snapshot.some(entry=>entry.ownerEmail?.toLowerCase()===email.toLowerCase())
  const changed=snapshot.some(source=>!allEligible.some(entry=>entry.id===source.id&&entry.revision===source.revision))
  const rejectionEntries=snapshot
  const rejectionAllowed=selectedGroups.length===1&&!snapshotHasOwn
  const rejectionPeriod=snapshot.length?periodFor(snapshot[0]):null
  const correctionDeadlineCap=rejectionPeriod?.exceptionResolutionDeadline??rejectionPeriod?.accountApprovalDeadline??rejectionPeriod?.submissionDeadline
  const correctionDeadlineLocal=correctionDeadlineCap?new Date(Date.parse(correctionDeadlineCap)-new Date(correctionDeadlineCap).getTimezoneOffset()*60_000).toISOString().slice(0,16):undefined

  useEffect(()=>{
    if(dialog==="reject"&&!correctionDueAt&&correctionDeadlineLocal)setCorrectionDueAt(correctionDeadlineLocal)
  },[dialog,correctionDueAt,correctionDeadlineLocal])

  function openReview(){setError("");setSnapshot(selectedEntries.map(entry=>({...entry})));setRejectedEntryId("");setNote("");setCorrectionDueAt("");setDialog("approve")}

  async function advise(){
    setBusy(true);setError("");setSuggestions([]);setDialog("ai")
    try{const response=await fetch(apiPath("/api/review"),{method:"POST",signal:AbortSignal.timeout(35000),headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:selectedEntries.map(entry=>entry.id)})});const data=await response.json();if(!response.ok)throw new Error(data.error);setSuggestions(data.recommendations)}
    catch(error){setError(error instanceof Error?error.message:"Review unavailable.")}finally{setBusy(false)}
  }

  async function decide(records:TimeEntry[],status:"approved"|"rejected",reason?:string,badEntryId?:string){
    if(operation.current||!canReview||!records.length||(status==="rejected"&&(!reason?.trim()||!badEntryId)))return
    const grouped=new Map<string,TimeEntry[]>()
    for(const entry of records){const period=periodFor(entry);const key=`${entry.ownerEmail?.toLowerCase()??entry.contractor.toLowerCase()}:${period.id}`;grouped.set(key,[...(grouped.get(key)??[]),entry])}
    const batches=[...grouped.values()]
    if(status==="rejected"&&(batches.length!==1||records.some(entry=>entry.ownerEmail?.toLowerCase()===email.toLowerCase()))){setError("Return one complete timesheet at a time. You cannot return your own business-account timesheet.");return}
    if(status==="approved"&&records.some(entry=>entry.approvalEligible===false)){setError("Approval requires forwarding rights. You can still return a timesheet for correction.");return}
    operation.current=true;setBusy(true);setError("")
    try{
      let completed=0
      for(const batch of batches){
        const targetId=status==="rejected"?badEntryId!:batch[0].id
        const target=batch.find(entry=>entry.id===targetId)??batch[0]
        const response=await fetch(apiPath(`/api/entries/${targetId}`),{method:"PATCH",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({status,reviewNote:reason,correctionDueAt:status==="rejected"?new Date(correctionDueAt).toISOString():undefined,expectedRevision:target.revision,batchEntries:batch.map(entry=>({id:entry.id,revision:entry.revision}))})})
        const data=await response.json()
        if(!response.ok)throw new Error(`${target.contractor}: ${data.error}${data.reference?` Reference: ${data.reference}`:""}`)
        for(const updated of data.entries??[data.entry])onUpdated(updated)
        completed+=batch.length
        const group=allGroups.find(item=>item.entries.some(entry=>entry.id===targetId))
        if(group)setSelectedKeys(previous=>previous.filter(key=>key!==group.key))
        setSnapshot(previous=>previous.filter(source=>!batch.some(entry=>entry.id===source.id)))
      }
      setFeedback(status==="approved"?`${completed} entries across ${batches.length} complete timesheet${batches.length===1?"":"s"} ${finalApprover?"approved":"approved and sent to business accounts"}.`:`Timesheet returned. The selected entry is marked rejected; the other entries are drafts.`)
      setDialog(null)
    }catch(error){setError(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"Save timed out. Refresh before retrying; some timesheets may already be saved.":error instanceof Error?error.message:"Decision unavailable.")}
    finally{operation.current=false;setBusy(false)}
  }

  function selectVisible(){
    const capacity=Math.max(0,100-selectedGroups.reduce((count,group)=>count+group.entries.length,0))
    const next=visibleGroups.filter(group=>!selectedKeys.includes(group.key)).filter(group=>group.entries.length<=capacity)
    setSelectedKeys(previous=>[...previous,...next.map(group=>group.key)])
  }

  return <section aria-label="Timesheet approval queue" className="space-y-3 border-y py-3">
    <div className="flex flex-wrap gap-2"><input aria-label="Search review queue" placeholder="Search person or project" value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 rounded-md border bg-white p-2 text-sm"/><select aria-label="Review project" value={project} onChange={event=>setProject(event.target.value)} className="max-w-full rounded-md border bg-white p-2 text-sm"><option value="">All projects</option>{[...new Set(allEligible.map(entry=>entry.project))].sort().map(name=><option key={name}>{name}</option>)}</select><select aria-label="Review order" value={sort} onChange={event=>setSort(event.target.value)} className="rounded-md border bg-white p-2 text-sm"><option value="oldest">Period: oldest</option><option value="newest">Period: newest</option><option value="hours">Hours: highest</option></select></div>
    <p className="text-xs text-muted-foreground">{visibleGroups.length} timesheet{visibleGroups.length===1?"":"s"} visible · {allGroups.length} awaiting · {selectedGroups.length} selected ({selectedEntries.length} entries)</p>
    {feedback&&<p role="status" className="text-sm text-green-800">{feedback}</p>}
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{allowSelfApproval?"Final timesheet approvals":"Timesheet review"}</h2><Button variant="outline" size="sm" disabled={busy||!visibleGroups.length} onClick={selectVisible}>Select visible timesheets</Button><Button variant="outline" size="sm" disabled={busy||!selectedKeys.length} onClick={()=>setSelectedKeys([])}>Clear selection</Button>{canAI&&<Button size="sm" disabled={busy||!selectedEntries.length} onClick={advise}>AI suggestions</Button>}{canReview&&<Button size="sm" disabled={busy||!selectedEntries.length} onClick={openReview}>Review {selectedGroups.length} timesheet{selectedGroups.length===1?"":"s"}</Button>}</div>
    <div className="max-h-[55dvh] overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 bg-orange-50"><tr><th className="p-2">Select</th><th className="p-2">Person / period</th><th className="p-2">Entries</th><th className="p-2">Projects</th><th className="p-2">Work dates</th><th className="p-2">Hours</th></tr></thead><tbody>{visibleGroups.map(group=><tr key={group.key} className="border-t"><td className="p-2 align-top"><input type="checkbox" aria-label={`Select timesheet ${group.person} ${group.period.name}`} disabled={busy||(!selectedKeys.includes(group.key)&&selectedEntries.length+group.entries.length>100)} checked={selectedKeys.includes(group.key)} onChange={event=>setSelectedKeys(previous=>event.target.checked?[...previous,group.key]:previous.filter(key=>key!==group.key))}/></td><td className="p-2 align-top"><div className="font-medium">{group.person}</div><div className="text-xs text-muted-foreground">{group.period.name}</div></td><td className="p-2 align-top tabular-nums">{group.entries.length}</td><td className="p-2 align-top">{[...new Set(group.entries.map(entry=>entry.project))].join(", ")}</td><td className="p-2 align-top">{group.entries[0]?.date}{group.entries.length>1?` – ${group.entries[group.entries.length-1]?.date}`:""}</td><td className="p-2 align-top tabular-nums">{group.entries.reduce((sum,entry)=>sum+entry.hours,0)}h</td></tr>)}</tbody></table></div>
    {dialog&&<WindowSurface title={dialog==="ai"?"AI timesheet suggestions":dialog==="reject"?"Return timesheet":"Confirm timesheet approvals"} disabled={busy} onBack={()=>setDialog(null)}><section className="flex w-full flex-col bg-white p-4"><h2 className="font-semibold">{dialog==="ai"?"AI timesheet suggestions":dialog==="reject"?"Return complete timesheet":"Approve complete timesheets"}</h2><div className="min-h-0 flex-1 overflow-auto py-4">{busy&&<p role="status">Processing...</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}{dialog==="ai"?suggestions.filter(item=>allEligible.some(entry=>entry.id===item.entryId&&entry.revision===item.revision)).map(item=>{const entry=allEligible.find(candidate=>candidate.id===item.entryId)!;const group=allGroups.find(candidate=>candidate.entries.some(candidateEntry=>candidateEntry.id===entry.id));return <article key={item.entryId} className="border-b py-3"><p>{entry.contractor} · {group?.period.name} · {item.decision}</p><p className="text-sm">{item.reason}</p>{canReview&&item.decision==="approved"&&group&&<Button disabled={busy} variant="outline" onClick={()=>{setSnapshot(group.entries.map(candidate=>({...candidate})));void decide(group.entries,"approved")}}>Approve this timesheet</Button>}{canReview&&item.decision!=="approved"&&group&&<Button disabled={busy} variant="outline" onClick={()=>{setSnapshot(group.entries.map(candidate=>({...candidate})));setRejectedEntryId("");setNote("");setDialog("reject")}}>Review return for this timesheet</Button>}</article>}) : <>
      {snapshotGroupsForView(snapshot,periodFor).map(group=><article key={group.key} className="mb-4 border-b pb-3"><h3 className="font-medium">{group.person} · {group.period.name}</h3><p className="mb-2 text-xs text-muted-foreground">{group.entries.length} entries · {group.entries.reduce((sum,entry)=>sum+entry.hours,0)}h</p>{group.entries.map(entry=><label key={entry.id} className="flex items-center gap-2 border-t py-2 text-sm"><input type="radio" name="rejected-entry" aria-label={`Mark ${entry.project} ${entry.date} as rejected`} value={entry.id} checked={rejectedEntryId===entry.id} onChange={()=>setRejectedEntryId(entry.id)}/><span>{entry.date} · {entry.project} · {entry.hours}h · {entry.description}</span></label>)}</article>)}
    </>}</div>{dialog!=="ai"&&<><p className="mb-2 text-xs text-muted-foreground">Approval applies to every submitted entry in each selected timesheet. Returning a timesheet marks only the selected entry rejected and returns its other entries to draft.</p>{changed&&<p role="alert" className="mb-2 text-sm text-red-700">Evidence changed. Close and reopen this review before confirming.</p>}{dialog==="reject"&&<><label className="mb-3 grid gap-1 text-sm">Correction deadline<input aria-label="Correction deadline" type="datetime-local" required disabled={busy} min={new Date(Date.now()-new Date().getTimezoneOffset()*60_000).toISOString().slice(0,16)} max={correctionDeadlineLocal} value={correctionDueAt} onChange={event=>setCorrectionDueAt(event.target.value)} className="h-9 rounded border px-2"/><span className="text-xs text-muted-foreground">Must be no later than {correctionDeadlineCap?new Date(correctionDeadlineCap).toLocaleString():"the configured period resolution deadline"}.</span></label><label className="mb-3 block text-sm">Reason<textarea aria-label="Timesheet return reason" disabled={busy} maxLength={500} value={note} onChange={event=>setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded border p-2"/></label></> }<div className="flex flex-wrap gap-2">{dialog==="approve"&&rejectionAllowed&&<Button variant="outline" disabled={busy} onClick={()=>{setRejectedEntryId("");setNote("");setCorrectionDueAt("");setDialog("reject")}}>Return one timesheet</Button>}{dialog==="reject"&&<Button variant="outline" disabled={busy} onClick={()=>setDialog("approve")}>Back to approval</Button>}<Button disabled={busy||changed||!snapshot.length||!canReview||(dialog==="approve"&&snapshot.some(entry=>entry.approvalEligible===false))||(dialog==="reject"&&(!note.trim()||!rejectedEntryId||!rejectionAllowed||!correctionDueAt))} onClick={()=>void decide(snapshot,dialog==="reject"?"rejected":"approved",dialog==="reject"?note.trim():undefined,dialog==="reject"?rejectedEntryId:undefined)}>{dialog==="reject"?"Return timesheet":"Approve selected timesheets"}</Button></div></>}</section></WindowSurface>}
  </section>
}

function snapshotGroupsForView(snapshot:TimeEntry[],periodFor:(entry:TimeEntry)=>Period){
  const groups=new Map<string,{key:string;person:string;period:Period;entries:TimeEntry[]}>()
  for(const entry of snapshot){const period=periodFor(entry);const key=`${entry.ownerEmail?.toLowerCase()??entry.contractor.toLowerCase()}:${period.id}`;const group=groups.get(key)??{key,person:entry.contractor,period,entries:[]};group.entries.push(entry);groups.set(key,group)}
  return [...groups.values()]
}
