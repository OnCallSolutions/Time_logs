"use client"

import { useEffect, useState } from "react"
import { Archive, FolderKanban, History, Plus, RotateCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type Project={id:string;name:string;description:string;active:boolean;createdBy?:string}
type Patron={email:string;displayName?:string;role:string}
type Assignment={projectId:string;email:string}
type AssignmentEvent={id:string;projectId:string;projectName:string;email:string;action:"assigned"|"reassigned"|"removed";actorEmail:string;occurredAt:string}

export function ProjectManagement({canManage=false,canCreate=false,fullWidth=false}:{canManage?:boolean;canCreate?:boolean;fullWidth?:boolean}){
  const [projects,setProjects]=useState<Project[]>([])
  const [patrons,setPatrons]=useState<Patron[]>([])
  const [assignments,setAssignments]=useState<Assignment[]>([])
  const [assignmentHistory,setAssignmentHistory]=useState<AssignmentEvent[]>([])
  const [name,setName]=useState("")
  const [description,setDescription]=useState("")
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
    setBusy(path);setError("");setNotice("")
    try{
      const response=await fetch(apiPath(path),{method:path==="/api/projects"?"POST":"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Project change could not be saved.")
      setNotice(path==="/api/projects"?(canManage?"Project created.":"Project created and assigned to you."):"Project settings saved.")
      if(path==="/api/projects"){setName("");setDescription("")}
      await refresh()
    }catch(cause){setError(cause instanceof Error?cause.message:"Project change could not be saved.")}
    finally{setBusy("")}
  }

  return <section className={`flex w-full flex-col gap-4 ${fullWidth?"max-w-none p-3 sm:p-4":"mx-auto max-w-6xl p-4 sm:p-6"}`}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2">
      <div><h2 className="flex items-center gap-2 font-semibold text-emerald-950"><FolderKanban className="size-4"/>{canManage?"Project assignments":"My projects"}</h2><p className="text-xs text-emerald-900">{canManage?"Assign projects across timesheet periods. Assignments stay active until changed or the project is archived.":"Your assigned projects stay available across timesheet periods until changed or archived."}</p></div>
      <span className="text-xs text-slate-600">{projects.filter(project=>project.active).length} active{canManage?` · ${patrons.length} people`:""}</span>
    </header>
    {canCreate&&<form className="grid gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_auto]" onSubmit={event=>{event.preventDefault();void save("/api/projects",{name,description})}}>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Project name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. Field Operations"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Description<input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Optional purpose or client"/></label>
      <Button className="self-end" type="submit" disabled={!!busy||!name.trim()}><Plus className="size-4"/>Create project</Button>
    </form>}
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {notice&&!error&&<p role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
    {loading?<p role="status" className="text-sm text-slate-600">Loading project catalog…</p>:projects.length===0?<p className="border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-600">{canCreate?"No projects yet. Create a project to begin logging time.":"No projects are assigned to you yet. Ask your manager to assign one."}</p>:<><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]"><label className="relative"><Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-slate-500"/><input type="search" aria-label="Search projects and assignments" value={projectSearch} onChange={event=>setProjectSearch(event.target.value)} placeholder="Search project names, descriptions, or creators" className="h-9 w-full border border-slate-300 bg-white pl-9 pr-2 text-sm"/></label><select aria-label="Filter projects by status" value={projectState} onChange={event=>setProjectState(event.target.value)} className="h-9 border border-slate-300 bg-white px-2 text-sm"><option value="active">Active projects</option><option value="all">All projects</option><option value="archived">Archived projects</option></select></div><p className="text-xs text-slate-600">Showing {visibleProjects.length} of {projects.length} projects</p><div className="divide-y divide-slate-200 border-y border-slate-200">
      {visibleProjects.map(project=><article key={project.id} className={`grid gap-3 py-3 md:grid-cols-[minmax(12rem,1fr)_minmax(20rem,2fr)_auto] ${project.active?"":"opacity-70"}`}>
        <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{project.name}{!project.active&&<span className="ml-2 text-xs font-normal text-slate-500">Archived</span>}</p>{project.description&&<p className="mt-0.5 break-words text-xs text-slate-600">{project.description}</p>}{project.createdBy&&<p className="mt-0.5 truncate text-[10px] text-slate-500">Created by {project.createdBy}</p>}{canManage&&(()=>{const events=assignmentHistory.filter(item=>item.projectId===project.id);return events.length?<details className="mt-2 border-t border-slate-100 pt-1.5"><summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-sky-800"><History className="size-3.5"/>Assignment history ({events.length})</summary><ol className="mt-2 max-h-40 space-y-1 overflow-auto border-l border-slate-200 pl-3">{events.map(item=><li key={item.id} className="text-[10px] text-slate-600"><span className="font-medium text-slate-800">{item.email}</span> {item.action} by <span className="font-medium">{item.actorEmail}</span><time className="ml-1" dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></li>)}</ol></details>:null})()}</div>
        {canManage&&<fieldset disabled={!project.active||!!busy} className="flex flex-wrap gap-x-4 gap-y-2 rounded-md bg-slate-50 px-3 py-2">
          <legend className="sr-only">People assigned to {project.name}</legend>
          {(()=>{const projectAssignments=assignments.filter(item=>item.projectId===project.id);const projectPatrons=patrons.filter(patron=>patron.role==="employee"||patron.role==="contractor"||projectAssignments.some(item=>item.email.toLowerCase()===patron.email.toLowerCase()));return projectPatrons.length?projectPatrons.map(patron=>{const assigned=projectAssignments.some(item=>item.email.toLowerCase()===patron.email.toLowerCase());const isManager=patron.role==="manager"||patron.role==="account_manager";return <label key={patron.email} title={isManager?"Assigned manager for this project":"Assign this project"} className="flex max-w-full items-center gap-1.5 text-xs text-slate-800"><input type="checkbox" className="accent-emerald-700" checked={assigned} disabled={isManager} onChange={event=>void save("/api/projects",{action:"assignment",projectId:project.id,email:patron.email,assigned:event.target.checked})}/><span className="truncate">{patron.displayName||patron.email}{isManager&&<span className="ml-1 text-emerald-800">· Assigned manager</span>}</span></label>}):<span className="text-xs text-slate-500">No active contractors or employees found.</span>})()}
        </fieldset>}
        {canManage&&<Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={()=>void save("/api/projects",{action:"status",projectId:project.id,active:!project.active})}>{project.active?<><Archive className="size-4"/>Archive</>:<><RotateCcw className="size-4"/>Restore</>}</Button>}
      </article>)}
    </div>{!visibleProjects.length&&<p className="px-3 py-6 text-center text-sm text-slate-600">No projects match these filters.</p>}</>}
    {busy&&<span className="sr-only" role="status">Saving project settings</span>}
  </section>
}
