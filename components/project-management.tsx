"use client"

import { useEffect, useState } from "react"
import { Archive, FolderKanban, History, Pause, Play, Plus, RotateCcw, Search, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type Project={id:string;name:string;description:string;active:boolean;createdBy?:string;managerEmail?:string|null;used?:boolean}
type Patron={email:string;displayName?:string;role:string}
type Assignment={projectId:string;email:string;status?:"active"|"paused"}
type AssignmentEvent={id:string;projectId:string;projectName:string;email:string;action:"assigned"|"reassigned"|"removed"|"paused"|"resumed";actorEmail:string;occurredAt:string}

function projectNameSimilarity(left:string,right:string){
  const normalize=(value:string)=>value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).map(token=>token.length>3&&token.endsWith("s")?token.slice(0,-1):token).join(" ")
  const a=normalize(left),b=normalize(right)
  if(!a||!b)return 0
  if(a===b)return 1
  const aTokens=new Set(a.split(/\s+/)),bTokens=new Set(b.split(/\s+/))
  const overlap=[...aTokens].filter(token=>bTokens.has(token)).length/Math.max(1,new Set([...aTokens,...bTokens]).size)
  const shorter=a.length<=b.length?a:b,longer=a.length<=b.length?b:a
  const prefix=longer.startsWith(shorter)?shorter.length/longer.length:0
  return Math.max(overlap,prefix)
}

export function ProjectManagement({canManage=false,canCreate=false,fullWidth=false,organizationWide=false}:{canManage?:boolean;canCreate?:boolean;fullWidth?:boolean;organizationWide?:boolean}){
  const [projects,setProjects]=useState<Project[]>([])
  const [patrons,setPatrons]=useState<Patron[]>([])
  const [assignments,setAssignments]=useState<Assignment[]>([])
  const [assignmentHistory,setAssignmentHistory]=useState<AssignmentEvent[]>([])
  const [name,setName]=useState("")
  const [description,setDescription]=useState("")
  const [selectedPatrons,setSelectedPatrons]=useState<string[]>([])
  const [busy,setBusy]=useState("")
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  const [notice,setNotice]=useState("")
  const [projectSearch,setProjectSearch]=useState("")
  const [projectState,setProjectState]=useState("active")

  async function refresh(){
    setLoading(true)
    try{
      const projectResponse=await fetch(apiPath("/api/projects"),{cache:"no-store"})
      const projectData=await projectResponse.json()
      if(!projectResponse.ok)throw new Error(projectData.error??"Projects are unavailable.")
      setProjects(Array.isArray(projectData.projects)?projectData.projects:[])
      setAssignments(Array.isArray(projectData.assignments)?projectData.assignments:[])
      setAssignmentHistory(Array.isArray(projectData.assignmentHistory)?projectData.assignmentHistory:[])
      setPatrons(Array.isArray(projectData.patrons)?projectData.patrons:[])
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load projects.")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  const visibleProjects=projects.filter(project=>{
    const matchesState=projectState==="all"||projectState==="active"&&project.active||projectState==="archived"&&!project.active
    return matchesState&&[project.name,project.description,project.createdBy].join(" ").toLowerCase().includes(projectSearch.trim().toLowerCase())
  })

  async function save(path:`/${string}`,body:unknown){
    const action=typeof body==="object"&&body!==null&&"action" in body?String(body.action):""
    const creatingProject=path==="/api/projects"&&!action
    setBusy(path);setError("");setNotice("")
    try{
      const method=creatingProject?"POST":"PATCH"
      const response=await fetch(apiPath(path),{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Project change could not be saved.")
      setNotice(creatingProject?(canManage?"Project created and assignments applied.":"Project created for you. Your appointed manager can review it after you submit timesheet entries."):action==="merge"?`Project matched to ${data.targetName}; ${data.updatedEntries} of your timesheet entries now use the approved project name.`:action==="assignment_status"?"Project assignment status updated.":action==="assignment"?"Project assignments updated.":action==="delete_unused"?"Unused project deleted.":"Project settings saved.")
      if(creatingProject){setName("");setDescription("");setSelectedPatrons([])}
      await refresh()
    }catch(cause){setError(cause instanceof Error?cause.message:"Project change could not be saved.")}
    finally{setBusy("")}
  }

  return <section className={`flex w-full flex-col gap-4 ${fullWidth?"max-w-none p-3 sm:p-4":"mx-auto max-w-6xl p-4 sm:p-6"}`}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2">
      <div><h2 className="flex items-center gap-2 font-semibold text-emerald-950"><FolderKanban className="size-4"/>{canManage?organizationWide?"Organization projects and assignments":"My projects and team assignments":"My projects"}</h2><p className="text-xs text-emerald-900">{canManage?organizationWide?"Oversee project assignments across the organization.":"Manage projects and assignments for your own team.":"Your assigned projects stay available across timesheet periods until changed or archived."}</p></div>
      <span className="text-xs text-slate-600">{projects.filter(project=>project.active).length} active{canManage?` · ${patrons.length} people`:""}</span>
    </header>
    {canCreate&&<form className="grid gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-3" onSubmit={event=>{event.preventDefault();void save("/api/projects",{name,description,initialAssignmentEmails:canManage?selectedPatrons:[]})}}>
      <div className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_auto]">
      <label className="grid gap-1 text-xs font-medium text-slate-700">Project name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. Field Operations"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Description<input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Optional purpose or client"/></label>
      <Button className="self-end" type="submit" disabled={!!busy||!name.trim()}><Plus className="size-4"/>Create project</Button>
      </div>
      {canManage&&<div className="border-t border-sky-200 pt-2">
        <fieldset disabled={!!busy||loading}>
          <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-800"><Users className="size-3.5"/>Assign contractors <span className="font-normal text-slate-600">(optional)</span></legend>
          <div className="grid max-h-32 grid-cols-1 gap-x-4 gap-y-1 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {patrons.filter(patron=>patron.role==="contractor").map(patron=><label key={patron.email} className="flex min-w-0 items-center gap-2 py-1 text-xs text-slate-800"><input type="checkbox" className="accent-emerald-700" checked={selectedPatrons.includes(patron.email)} onChange={event=>setSelectedPatrons(current=>event.target.checked?[...current,patron.email]:current.filter(email=>email!==patron.email))}/><span className="truncate">{patron.displayName||patron.email}</span></label>)}
            {!loading&&!patrons.some(patron=>patron.role==="contractor")&&<p className="py-1 text-xs text-slate-600">No contractors are available in your team yet.</p>}
          </div>
        </fieldset>
        {patrons.some(patron=>patron.role==="employee")&&<details className="mt-2 border-t border-sky-100 pt-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">Employee assignments <span className="font-normal text-slate-500">(optional)</span></summary>
          <fieldset disabled={!!busy||loading} className="mt-1">
            <legend className="sr-only">Assign employees at project creation</legend>
            <div className="grid max-h-28 grid-cols-1 gap-x-4 gap-y-1 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {patrons.filter(patron=>patron.role==="employee").map(patron=><label key={patron.email} className="flex min-w-0 items-center gap-2 py-1 text-xs text-slate-800"><input type="checkbox" className="accent-emerald-700" checked={selectedPatrons.includes(patron.email)} onChange={event=>setSelectedPatrons(current=>event.target.checked?[...current,patron.email]:current.filter(email=>email!==patron.email))}/><span className="truncate">{patron.displayName||patron.email}</span></label>)}
            </div>
          </fieldset>
        </details>}
      </div>}
    </form>}
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {notice&&!error&&<p role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
    {loading?<p role="status" className="text-sm text-slate-600">Loading project catalog…</p>:projects.length===0?<p className="border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-600">{canCreate?"No projects yet. Create a project to begin logging time.":"No projects are assigned to you yet. Ask your manager to assign one."}</p>:<><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]"><label className="relative"><Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-slate-500"/><input type="search" aria-label="Search projects and assignments" value={projectSearch} onChange={event=>setProjectSearch(event.target.value)} placeholder="Search project names, descriptions, or creators" className="h-9 w-full border border-slate-300 bg-white pl-9 pr-2 text-sm"/></label><select aria-label="Filter projects by status" value={projectState} onChange={event=>setProjectState(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm"><option value="active">Active projects</option><option value="all">All projects</option><option value="archived">Archived projects</option></select></div><p className="text-xs text-slate-600">Showing {visibleProjects.length} of {projects.length} projects</p><div className="divide-y divide-slate-200 border-y border-slate-200">
      {visibleProjects.map(project=><article key={project.id} className={`grid gap-3 py-3 md:grid-cols-[minmax(12rem,1fr)_minmax(20rem,2fr)_auto] ${project.active?"":"opacity-70"}`}>
        <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{project.name}{!project.active&&<span className="ml-2 text-xs font-normal text-slate-500">Archived</span>}{project.managerEmail&&<span className="ml-2 text-xs font-medium text-amber-800">Patron-created</span>}</p>{project.description&&<p className="mt-0.5 break-words text-xs text-slate-600">{project.description}</p>}{project.createdBy&&<p className="mt-0.5 truncate text-[10px] text-slate-500">Created by {project.createdBy}</p>}{project.managerEmail&&<p className="mt-0.5 truncate text-[10px] text-emerald-800">Appointed manager: {patrons.find(patron=>patron.email.toLowerCase()===project.managerEmail?.toLowerCase())?.displayName||project.managerEmail}</p>}{canManage&&project.active&&project.managerEmail&&project.createdBy?.toLowerCase()!==project.managerEmail.toLowerCase()&&(()=>{const candidates=projects.filter(candidate=>candidate.id!==project.id&&candidate.active&&!candidate.managerEmail).map(candidate=>({project:candidate,score:projectNameSimilarity(project.name,candidate.name)})).filter(candidate=>candidate.score>=0.45).sort((a,b)=>b.score-a.score).slice(0,3);return candidates.length?<div className="mt-2 border-t border-amber-100 pt-2"><p className="text-xs font-medium text-amber-900">Possible existing project</p><p className="mt-0.5 text-[10px] text-slate-600">Review a match before merging. The contractor's entries and assignment history are preserved.</p><div className="mt-1 flex flex-wrap gap-1.5">{candidates.map(({project:target})=><Button key={target.id} type="button" variant="outline" size="sm" disabled={!!busy} title="Move this contractor's entries to the selected canonical project and archive this proposal" onClick={()=>{if(window.confirm(`Merge ${project.name} into ${target.name}? This updates this contractor's timesheet project names, preserves the original project record, and archives the duplicate.`))void save("/api/projects",{action:"merge",sourceProjectId:project.id,targetProjectId:target.id})}}>{target.name} · Merge</Button>)}</div></div>:null})()}{canManage&&(()=>{const events=assignmentHistory.filter(item=>item.projectId===project.id);return events.length?<details className="mt-2 border-t border-slate-100 pt-1.5"><summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-sky-800"><History className="size-3.5"/>Assignment history ({events.length})</summary><ol className="mt-2 max-h-40 space-y-1 overflow-auto border-l border-slate-200 pl-3">{events.map(item=><li key={item.id} className="text-[10px] text-slate-600"><span className="font-medium text-slate-800">{item.email}</span> {item.action} by <span className="font-medium">{item.actorEmail}</span><time className="ml-1" dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></li>)}</ol></details>:null})()}</div>
        {canManage&&<fieldset disabled={!project.active||!!busy} className="flex flex-wrap gap-x-4 gap-y-2 rounded-md bg-slate-50 px-3 py-2">
          <legend className="sr-only">People assigned to {project.name}</legend>
          {(()=>{const projectAssignments=assignments.filter(item=>item.projectId===project.id);const projectPatrons=patrons.filter(patron=>patron.role==="employee"||patron.role==="contractor");return projectPatrons.length?projectPatrons.map(patron=>{const assignment=projectAssignments.find(item=>item.email.toLowerCase()===patron.email.toLowerCase());const assigned=!!assignment;const paused=assignment?.status==="paused";return <div key={patron.email} className="flex min-w-0 items-center gap-1.5 text-xs text-slate-800"><label title="Assign this project" className="flex min-w-0 items-center gap-1.5"><input type="checkbox" className="accent-emerald-700" checked={assigned} onChange={event=>{if(!event.target.checked&&!window.confirm(`Remove ${patron.displayName||patron.email} from ${project.name}? Existing timesheets and history will be kept.`)){return}void save("/api/projects",{action:"assignment",projectId:project.id,email:patron.email,assigned:event.target.checked})}}/><span className="truncate">{patron.displayName||patron.email}</span></label><span className={paused?"shrink-0 text-amber-700":"sr-only"}>{paused?"Paused":""}</span>{assigned&&<Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" title={paused?"Resume project assignment":"Pause project assignment"} aria-label={`${paused?"Resume":"Pause"} ${patron.displayName||patron.email} on ${project.name}`} disabled={!!busy} onClick={()=>void save("/api/projects",{action:"assignment_status",projectId:project.id,email:patron.email,status:paused?"active":"paused"})}>{paused?<Play className="size-3.5"/>:<Pause className="size-3.5"/>}</Button>}</div>}):<span className="text-xs text-slate-500">No employees or contractors found in this manager scope.</span>})()}
        </fieldset>}
        {canManage&&<div className="flex flex-wrap items-start gap-1">
          <Button type="button" variant="outline" size="sm" title={project.active?"Stop new assignments and time entry while preserving all records":"Restore this archived project"} disabled={!!busy} onClick={()=>void save("/api/projects",{action:"status",projectId:project.id,active:!project.active})}>{project.active?<><Archive className="size-4"/>Archive</>:<><RotateCcw className="size-4"/>Restore</>}</Button>
          {!project.used&&!assignments.some(item=>item.projectId===project.id)&&!assignmentHistory.some(item=>item.projectId===project.id)&&<Button type="button" variant="ghost" size="sm" title="Permanently delete only if this project has never had timesheet activity or assignments" disabled={!!busy} onClick={()=>{if(window.confirm(`Permanently delete unused project ${project.name}? This is available only when no timesheets or assignment history exist.`))void save("/api/projects",{action:"delete_unused",projectId:project.id})}}><Trash2 className="size-4"/>Delete unused</Button>}
        </div>}
      </article>)}
    </div>{!visibleProjects.length&&<p className="px-3 py-6 text-center text-sm text-slate-600">No projects match these filters.</p>}</>}
    {busy&&<span className="sr-only" role="status">Saving project settings</span>}
  </section>
}
