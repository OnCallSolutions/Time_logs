"use client"
import { useCallback,useEffect,useMemo,useRef,useState } from "react"
import { Activity,RefreshCw,Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataExportMenu } from "@/components/data-export-menu"
import { apiPath } from "@/lib/paths"

type Run={id:string;actor_email:string;workspace_key:string;model_id:string;status:"running"|"succeeded"|"failed";request_chars:number;response_chars:number;proposals:number;duration_ms:number|null;error_code:string|null;started_at:string;completed_at:string|null}

/** Shows sanitized assistant latency, outcome, and proposal activity without storing prompt content. */
export function AssistantRunReport(){
  const [runs,setRuns]=useState<Run[]>([]),[query,setQuery]=useState(""),[status,setStatus]=useState("all"),[from,setFrom]=useState(""),[through,setThrough]=useState(""),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[hasMore,setHasMore]=useState(false),[error,setError]=useState("")
  const runsRef=useRef<Run[]>([])
  const load=useCallback(async(append=false)=>{
    if(append)setLoadingMore(true);else setLoading(true)
    setError("")
    try{
      const current=append?runsRef.current:[],last=append?current.at(-1):undefined,params=new URLSearchParams({limit:"50"})
      if(last){params.set("beforeAt",new Date(last.started_at).toISOString());params.set("beforeId",last.id)}
      if(query.trim())params.set("search",query.trim())
      if(status!=="all")params.set("status",status)
      if(from)params.set("from",from)
      if(through)params.set("through",through)
      const response=await fetch(`${apiPath("/api/assistant/runs")}?${params}`,{cache:"no-store"}),data=await response.json()
      if(!response.ok)throw new Error(data.error||"AI activity could not be loaded.")
      const next=append?[...current,...data.runs]:data.runs;runsRef.current=next;setRuns(next);setHasMore(!!data.hasMore)
    }catch(cause){setError(cause instanceof Error?cause.message:"AI activity could not be loaded.")}
    finally{setLoading(false);setLoadingMore(false)}
  },[query,status,from,through])
  useEffect(()=>{const timer=setTimeout(()=>void load(),250);return()=>clearTimeout(timer)},[load])
  const visible=useMemo(()=>runs.filter(run=>(status==="all"||run.status===status)&&`${run.actor_email} ${run.workspace_key} ${run.model_id} ${run.error_code??""}`.toLowerCase().includes(query.trim().toLowerCase())),[runs,status,query])
  const failed=runs.filter(run=>run.status==="failed").length,succeeded=runs.filter(run=>run.status==="succeeded").length
  return <section aria-label="AI workflow activity" className="flex min-h-0 w-full flex-col gap-3 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-3 py-2"><div><h2 className="flex items-center gap-2 font-semibold text-blue-950"><Activity className="size-4 text-blue-700"/>AI workflow activity</h2><p className="text-xs text-blue-900">Sanitized operational metadata only. Prompts, timesheet text, and message contents are not displayed.</p></div><div className="flex items-center gap-2"><DataExportMenu title="AI workflow activity" filename="ai-workflow-activity" rows={visible.map(run=>({started:new Date(run.started_at).toISOString(),actor:run.actor_email,workspace:run.workspace_key,model:run.model_id,outcome:run.status,durationMs:run.duration_ms,proposals:run.proposals,errorCode:run.error_code}))} summary={{runs:visible.length,failed:visible.filter(run=>run.status==="failed").length,succeeded:visible.filter(run=>run.status==="succeeded").length}}/><Button variant="outline" size="sm" onClick={()=>void load()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button></div></header>
    <div className="grid gap-2 sm:grid-cols-3"><div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2"><span className="text-xs text-blue-900">Runs loaded</span><strong className="block text-lg tabular-nums">{runs.length}</strong></div><div className="border-l-4 border-green-500 bg-green-50 px-3 py-2"><span className="text-xs text-green-900">Succeeded</span><strong className="block text-lg tabular-nums">{succeeded}</strong></div><div className="border-l-4 border-red-500 bg-red-50 px-3 py-2"><span className="text-xs text-red-900">Failed</span><strong className="block text-lg tabular-nums">{failed}</strong></div></div>
    <div className="flex flex-wrap gap-2"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-slate-500"/><input aria-label="Search AI runs" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search actor, window, model, or failure code" className="h-9 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm"/></label><select aria-label="Filter AI run status" value={status} onChange={event=>setStatus(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="all">All outcomes</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="running">Running</option></select><label className="text-xs text-slate-600">From<input aria-label="AI run date from" type="date" value={from} max={through||undefined} onChange={event=>setFrom(event.target.value)} className="ml-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"/></label><label className="text-xs text-slate-600">Through<input aria-label="AI run date through" type="date" value={through} min={from||undefined} onChange={event=>setThrough(event.target.value)} className="ml-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"/></label></div>
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200"><table className="w-full min-w-[850px] text-left text-sm"><thead className="sticky top-0 bg-sky-50 text-[11px] uppercase text-sky-950"><tr><th className="px-3 py-2">Started</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Workspace</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Duration</th><th className="px-3 py-2">Proposals</th><th className="px-3 py-2">Failure code</th></tr></thead><tbody>{visible.map(run=><tr key={run.id} className="border-t border-slate-100 odd:bg-white even:bg-sky-50/30 hover:bg-orange-50"><td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(run.started_at).toLocaleString()}</td><td className="px-3 py-2">{run.actor_email}</td><td className="px-3 py-2">{run.workspace_key}</td><td className="px-3 py-2 font-mono text-xs">{run.model_id}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${run.status==="succeeded"?"bg-green-100 text-green-800":run.status==="failed"?"bg-red-100 text-red-800":"bg-blue-100 text-blue-800"}`}>{run.status}</span></td><td className="px-3 py-2 tabular-nums">{run.duration_ms===null?"—":`${run.duration_ms} ms`}</td><td className="px-3 py-2 tabular-nums">{run.proposals}</td><td className="px-3 py-2 font-mono text-xs text-red-800">{run.error_code??"—"}</td></tr>)}{!loading&&!visible.length&&<tr><td className="px-3 py-8 text-center text-slate-600" colSpan={8}>{runs.length?"No runs match those filters.":"No AI activity recorded yet."}</td></tr>}</tbody></table>{loading&&<p role="status" className="p-5 text-center text-sm text-slate-600">Loading AI activity...</p>}</div>
    {hasMore&&<Button variant="outline" size="sm" className="self-center" disabled={loadingMore} onClick={()=>void load(true)}>{loadingMore?"Loading...":"Load older AI activity"}</Button>}
  </section>
}
