"use client"

import { Fragment,useMemo,useState } from "react"
import { History,RefreshCw,Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { DataExportMenu } from "@/components/data-export-menu"
import { apiPath } from "@/lib/paths"
import type { EntryRejectionRecord } from "@/lib/db"

type SortMode="newest"|"oldest"|"person"
type GroupMode="person"|"day"|"month"|"none"

/** Shows each manager's append-only rejection history with useful person and date views. */
export function ManagerRejectionArchive(){
  const [open,setOpen]=useState(false),[rows,setRows]=useState<EntryRejectionRecord[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[query,setQuery]=useState(""),[sort,setSort]=useState<SortMode>("newest"),[group,setGroup]=useState<GroupMode>("person")
  async function load(){
    setLoading(true);setError("")
    try{const response=await fetch(apiPath("/api/entries/rejections"),{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load rejection archive.");setRows(data.rejections??[])}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not load rejection archive.")}
    finally{setLoading(false)}
  }
  function show(){setOpen(true);void load()}
  const filtered=useMemo(()=>rows.filter(row=>`${row.contractor} ${row.project} ${row.reason} ${row.workDate??""}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>sort==="person"?a.contractor.localeCompare(b.contractor)||b.rejectedAt.localeCompare(a.rejectedAt):sort==="oldest"?a.rejectedAt.localeCompare(b.rejectedAt):b.rejectedAt.localeCompare(a.rejectedAt)),[rows,query,sort])
  const groups=useMemo(()=>Array.from(new Map(filtered.map(row=>{
    const date=new Date(row.rejectedAt),key=group==="person"?row.contractor:group==="day"?row.rejectedAt.slice(0,10):group==="month"?row.rejectedAt.slice(0,7):"all"
    const label=group==="person"?`Patron · ${row.contractor}`:group==="day"?`Day · ${date.toLocaleDateString()}`:group==="month"?`Month · ${date.toLocaleDateString(undefined,{month:"long",year:"numeric"})}`:"All rejections"
    return [key,{label,rows:filtered.filter(item=>(group==="person"?item.contractor:group==="day"?item.rejectedAt.slice(0,10):group==="month"?item.rejectedAt.slice(0,7):"all")===key)}] as const
  })).values()),[filtered,group])
  return <>
    <Button variant="outline" onClick={show}><History className="size-4"/>Rejection archive</Button>
    {open&&<WindowSurface title="Manager rejection archive" onBack={()=>setOpen(false)}><section className="flex min-h-0 w-full flex-col gap-3 bg-white p-4 text-slate-950 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-200 bg-orange-50 px-3 py-2"><div><h2 className="font-semibold text-orange-950">Your returned timesheets</h2><p className="text-xs text-orange-900">Append-only rejection history, grouped by submitter. Each decision retains its original reason and work details.</p></div><div className="flex items-center gap-2"><DataExportMenu title="Timesheet rejection archive" filename="timesheet-rejection-archive" rows={filtered.map(row=>({person:row.contractor,project:row.project,workDate:row.workDate??"",rejectedAt:row.rejectedAt,hours:row.hours,reason:row.reason}))} summary={{records:filtered.length,search:query||"None",sort,group}}/><Button size="sm" variant="outline" disabled={loading} onClick={()=>void load()}><RefreshCw className="size-4"/>Refresh</Button></div></header>
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_10rem_10rem]"><label className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-slate-500"/><input aria-label="Search rejections" className="h-9 w-full rounded border border-sky-200 bg-white pl-8 pr-2 text-sm" placeholder="Search person, project or reason" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="sr-only" htmlFor="rejection-sort">Sort rejections</label><select id="rejection-sort" aria-label="Sort rejections" className="h-9 rounded border border-blue-200 bg-white px-2 text-sm" value={sort} onChange={event=>setSort(event.target.value as SortMode)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="person">Person A-Z</option></select><label className="sr-only" htmlFor="rejection-group">Group rejections</label><select id="rejection-group" aria-label="Group rejections" className="h-9 rounded border border-emerald-200 bg-white px-2 text-sm" value={group} onChange={event=>setGroup(event.target.value as GroupMode)}><option value="person">Group by person</option><option value="day">Group by day</option><option value="month">Group by month</option><option value="none">No grouping</option></select></div>
      {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading?<p role="status" className="py-8 text-center text-sm text-slate-600">Loading rejection history...</p>:!filtered.length?<p role="status" className="py-8 text-center text-sm text-slate-600">No rejected timesheets found.</p>:<div className="min-h-0 flex-1 overflow-auto rounded border border-sky-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-sky-50 text-xs uppercase text-sky-950"><tr><th className="p-2">Person / work</th><th className="p-2">Work date</th><th className="p-2">Rejected at</th><th className="p-2">Hours</th><th className="p-2">Reason sent back</th></tr></thead><tbody>{groups.map(({label,rows:items})=><Fragment key={label}>{group!=="none"&&<tr className="border-y border-blue-200 bg-blue-50"><th colSpan={5} className="p-2 text-left text-blue-950">{label} · {items.length} rejection{items.length===1?"":"s"}</th></tr>}{items.map(row=><tr key={row.id} className="border-b border-slate-100 odd:bg-white even:bg-sky-50/30"><td className="p-2"><span className="block font-medium">{row.contractor}</span><span className="text-xs text-slate-600">{row.project||"No project"}</span></td><td className="whitespace-nowrap p-2">{row.workDate??"—"}</td><td className="whitespace-nowrap p-2 text-xs">{new Date(row.rejectedAt).toLocaleString()}</td><td className="p-2 tabular-nums">{row.hours===null?"—":`${row.hours}h`}</td><td className="max-w-[28rem] whitespace-pre-wrap break-words p-2">{row.reason||"No reason recorded"}</td></tr>)}</Fragment>)}</tbody></table></div>}
      <p className="text-xs text-slate-500">Showing {filtered.length} of {rows.length} retained decisions.</p>
    </section></WindowSurface>}
  </>
}
