"use client"

import { useEffect, useState } from "react"
import { Archive, Check, FolderKanban, Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type Project={id:string;name:string;description:string;active:boolean;createdBy?:string}
type Patron={email:string;displayName?:string;role:string}
type Assignment={projectId:string;email:string}

export function ProjectManagement({canManage=false,canCreate=false}:{canManage?:boolean;canCreate?:boolean}){
  const [projects,setProjects]=useState<Project[]>([])
  const [patrons,setPatrons]=useState<Patron[]>([])
  const [assignments,setAssignments]=useState<Assignment[]>([])
  const [name,setName]=useState("")
  const [description,setDescription]=useState("")
  const [busy,setBusy]=useState("")
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  const [notice,setNotice]=useState("")

  async function refresh(){
    setLoading(true)
    try{
      const projectResponse=await fetch(apiPath("/api/projects"),{cache:"no-store"})
      const projectData=await projectResponse.json()
      if(!projectResponse.ok)throw new Error(projectData.error??"Projects are unavailable.")
      setProjects(Array.isArray(projectData.projects)?projectData.projects:[])
      setAssignments(Array.isArray(projectData.assignments)?projectData.assignments:[])
      setPatrons(Array.isArray(projectData.patrons)?projectData.patrons:[])
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load projects.")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])

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

  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2">
      <div><h2 className="flex items-center gap-2 font-semibold text-emerald-950"><FolderKanban className="size-4"/>{canManage?"Project assignments":"My projects"}</h2><p className="text-xs text-emerald-900">{canManage?"Create projects and assign them to employees or contractors. Only assigned projects can be used to log time.":"Create projects for your work and use them to record time. Projects you create are assigned to you."}</p></div>
      <span className="text-xs text-slate-600">{projects.filter(project=>project.active).length} active{canManage?` · ${patrons.length} people`:""}</span>
    </header>
    {canCreate&&<form className="grid gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_auto]" onSubmit={event=>{event.preventDefault();void save("/api/projects",{name,description})}}>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Project name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. Field Operations"/></label>
      <label className="grid gap-1 text-xs font-medium text-slate-700">Description<input maxLength={500} value={description} onChange={event=>setDescription(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Optional purpose or client"/></label>
      <Button className="self-end" type="submit" disabled={!!busy||!name.trim()}><Plus className="size-4"/>Create project</Button>
    </form>}
    {error&&<p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {notice&&!error&&<p role="status" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
    {loading?<p role="status" className="text-sm text-slate-600">Loading project catalog…</p>:projects.length===0?<p className="border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-600">{canCreate?"No projects yet. Create a project to begin logging time.":"No projects are assigned to you yet. Ask your manager to assign one."}</p>:<div className="divide-y divide-slate-200 border-y border-slate-200">
      {projects.map(project=><article key={project.id} className={`grid gap-3 py-3 md:grid-cols-[minmax(12rem,1fr)_minmax(20rem,2fr)_auto] ${project.active?"":"opacity-70"}`}>
        <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{project.name}{!project.active&&<span className="ml-2 text-xs font-normal text-slate-500">Archived</span>}</p>{project.description&&<p className="mt-0.5 break-words text-xs text-slate-600">{project.description}</p>}{project.createdBy&&<p className="mt-0.5 truncate text-[10px] text-slate-500">Created by {project.createdBy}</p>}</div>
        {canManage&&<fieldset disabled={!project.active||!!busy} className="flex flex-wrap gap-x-4 gap-y-2 rounded-md bg-slate-50 px-3 py-2">
          <legend className="sr-only">People assigned to {project.name}</legend>
          {patrons.length?patrons.map(patron=><label key={patron.email} className="flex max-w-full items-center gap-1.5 text-xs text-slate-800"><input type="checkbox" className="accent-emerald-700" checked={assignments.some(item=>item.projectId===project.id&&item.email.toLowerCase()===patron.email.toLowerCase())} onChange={event=>void save("/api/projects",{action:"assignment",projectId:project.id,email:patron.email,assigned:event.target.checked})}/><span className="truncate">{patron.displayName||patron.email}</span></label>):<span className="text-xs text-slate-500">No active contractors or employees found.</span>}
        </fieldset>}
        {canManage&&<Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={()=>void save("/api/projects",{action:"status",projectId:project.id,active:!project.active})}>{project.active?<><Archive className="size-4"/>Archive</>:<><RotateCcw className="size-4"/>Restore</>}</Button>}
      </article>)}
    </div>}
    {busy&&<span className="sr-only" role="status">Saving project settings</span>}
  </section>
}
