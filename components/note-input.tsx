"use client"

/**
 * Provides the note input surface for manually entering time or preparing an
 * editable AI extraction before the user saves it.
 *
 * The input owns transient parsing and preview state. Persisted entries are
 * delegated to the parent only after an explicit save.
 */
import { useEffect, useState, type FormEvent } from "react"
import { Loader2, Plus, Sparkles, Trash2, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry } from "@/lib/types"

type EntryPeriod={id:string;name:string;startDate:string;endDate:string}
type EntryProject={id:string;name:string;description:string}

/**
 * Captures messy time notes and sends them to the parser API.
 *
 * Parsing is preview-only; projects and entries are persisted only after the
 * user confirms the preview.
 *
 * @param props - Component props.
 * @param props.onParsed - Callback invoked with entries after the user saves.
 * @returns The note entry form and parse controls.
 */
export function NoteInput({
  onParsed,
  previewOnly=false,
  canCreateProjects=false,
}: {
  onParsed: (entries: ParsedEntry[],periodId:string) => void | Promise<void>
  previewOnly?:boolean
  canCreateProjects?:boolean
}) {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sampleCount, setSampleCount] = useState("random")
  const [sampleLoaded,setSampleLoaded]=useState(false)
  const [sampleIsPreview, setSampleIsPreview] = useState(false)
  const [mode,setMode]=useState<"manual"|"notes">("manual")
  const [workDate,setWorkDate]=useState(()=>{const today=new Date();return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`})
  const [project,setProject]=useState("")
  const [projects,setProjects]=useState<EntryProject[]>([])
  const [newProjectName,setNewProjectName]=useState("")
  const [projectsError,setProjectsError]=useState("")
  const [projectsLoading,setProjectsLoading]=useState(!previewOnly)
  const [hours,setHours]=useState("")
  const [description,setDescription]=useState("")
  const [manualEntries,setManualEntries]=useState<ParsedEntry[]>([])
  const [parsedEntries,setParsedEntries]=useState<ParsedEntry[]>([])
  const [projectNamesFromNotes,setProjectNamesFromNotes]=useState<string[]>([])
  const [aiProjectChoice,setAiProjectChoice]=useState("__notes__")
  const [periods,setPeriods]=useState<EntryPeriod[]>([])
  const [periodId,setPeriodId]=useState("")
  const [periodsLoading,setPeriodsLoading]=useState(!previewOnly)
  const [periodsError,setPeriodsError]=useState("")
  useEffect(()=>{
    if(previewOnly)return
    const controller=new AbortController()
    fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Timesheet periods are unavailable.")
      const available:EntryPeriod[]=Array.isArray(data.periods)?data.periods:[]
      setPeriods(available)
      const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`
      const active=available.find(period=>period.startDate<=today&&period.endDate>=today)
      setPeriodId(active?.id??"")
    }).catch(cause=>{if(!controller.signal.aborted)setPeriodsError(cause instanceof Error?cause.message:"Timesheet periods are unavailable.")}).finally(()=>{if(!controller.signal.aborted)setPeriodsLoading(false)})
    return()=>controller.abort()
  },[previewOnly])
  useEffect(()=>{
    if(previewOnly)return
    const controller=new AbortController()
    fetch(apiPath("/api/projects"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Assigned projects are unavailable.")
      const available:EntryProject[]=Array.isArray(data.projects)?data.projects:[]
      setProjects(available)
      setProject(current=>available.some(item=>item.name===current)?current:available[0]?.name??"")
    }).catch(cause=>{if(!controller.signal.aborted)setProjectsError(cause instanceof Error?cause.message:"Assigned projects are unavailable.")}).finally(()=>{if(!controller.signal.aborted)setProjectsLoading(false)})
    return()=>controller.abort()
  },[previewOnly])
  const selectedPeriod=periods.find(period=>period.id===periodId)
  /**
   * Loads synthetic examples scoped by the authenticated server identity.
   * @returns Promise<void> after replacing notes or displaying a safe error.
   */
  async function loadSample(){
    setMode("notes");setLoading(true);setError(null);setProjectNamesFromNotes([])
    try{const response=await fetch(apiPath(`/api/samples?count=${sampleCount}`),{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error);setNotes(data.notes);setSampleLoaded(true);setSampleIsPreview(!!data.previewOnly);setParsedEntries([])}
    catch(error){setError(error instanceof Error?error.message:"Samples unavailable.")}finally{setLoading(false)}
  }

  /**
   * Parses the current notes into a reviewable preview without saving it.
   *
   * The handler blocks duplicate requests and displays parser errors inline.
   *
   * @returns A promise that resolves after parsing, saving, or error handling.
   */
  async function handleParse() {
    if (!notes.trim() || loading || previewOnly || sampleIsPreview) return
    if(!selectedPeriod){setError("Select a configured timesheet period before extracting entries.");return}
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiPath("/api/parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes,periodId:selectedPeriod.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.")
      const entries: ParsedEntry[] = data.entries ?? []
      if (entries.length === 0) {
        setError("No time entries were found in those notes.")
      } else {
        setProjectNamesFromNotes(entries.map(entry=>entry.project))
        setParsedEntries(entries.map(entry=>({...entry,project:aiProjectChoice==="__notes__"?entry.project:aiProjectChoice})))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse notes.")
    } finally {
      setLoading(false)
    }
  }

  async function saveParsedEntries(){
    if(!parsedEntries.length||loading||previewOnly||!selectedPeriod)return
    setLoading(true);setError(null)
    try{
      if(parsedEntries.some(entry=>!entry.project.trim()||/^(general|unassigned|unknown)$/i.test(entry.project.trim())))throw new Error("Choose a project for every preview row before saving.")
      const assignedNames=new Map(projects.map(item=>[item.name.trim().toLocaleLowerCase(),item.name.trim()]))
      const entriesToSave=parsedEntries.map(entry=>{const name=entry.project.trim();return {...entry,project:assignedNames.get(name.toLocaleLowerCase())??name}})
      const known=new Set(assignedNames.keys())
      const projectNames=[...new Map(entriesToSave.map(entry=>[entry.project.toLocaleLowerCase(),entry.project])).values()]
      const missing=projectNames.filter(name=>!known.has(name.toLocaleLowerCase()))
      if(missing.length&&!canCreateProjects)throw new Error(`These projects are not assigned to your account: ${missing.join(", ")}. Ask your manager to assign them.`)
      for(const projectName of missing){
        const response=await fetch(apiPath("/api/projects"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:projectName})})
        const data=await response.json()
        if(!response.ok){
          if(response.status===409){
            const current=await fetch(apiPath("/api/projects"),{cache:"no-store"}),currentData=await current.json()
            const assigned:EntryProject[]=Array.isArray(currentData.projects)?currentData.projects:[]
            if(current.ok&&assigned.some(item=>item.name.trim().toLocaleLowerCase()===projectName.toLocaleLowerCase()))continue
            throw new Error("“"+projectName+"” already exists but is not assigned to you. Ask your manager to assign it.")
          }
          throw new Error(data.error??("Unable to create project “"+projectName+"”."))
        }
      }
      if(missing.length){
        const response=await fetch(apiPath("/api/projects"),{cache:"no-store"}),data=await response.json()
        if(!response.ok)throw new Error(data.error??"The project was created, but the assigned project list could not be refreshed.")
        const available:EntryProject[]=Array.isArray(data.projects)?data.projects:[]
        setProjects(available);setProject(current=>available.some(item=>item.name===current)?current:available[0]?.name??"")
      }
      await onParsed(entriesToSave,selectedPeriod.id)
      setParsedEntries([]);setProjectNamesFromNotes([]);setNotes("");setSampleLoaded(false);setSampleIsPreview(false)
    }catch(err){setError(err instanceof Error?err.message:"Failed to save extracted entries.")}
    finally{setLoading(false)}
  }

  function addManualEntry(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(!selectedPeriod||workDate<selectedPeriod.startDate||workDate>selectedPeriod.endDate){setError("Choose a work date inside the selected timesheet period.");return}
    const value=Number(hours)
    if(!Number.isFinite(value)||value<=0||value>24)return
    if(!projects.some(item=>item.name===project)){setError("Select a project assigned to your account.");return}
    setManualEntries(previous=>[...previous,{contractor:"Self",date:workDate,hours:value,project,description:description.trim()}])
    setHours("");setDescription("")
  }

  async function createProject(){
    if(!canCreateProjects||!newProjectName.trim())return
    setLoading(true);setProjectsError("")
    try{
      const response=await fetch(apiPath("/api/projects"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:newProjectName.trim()})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Unable to create project.")
      if(data.project){setProjects(previous=>[...previous.filter(item=>item.id!==data.project.id),data.project]);setProject(data.project.name)}
      setNewProjectName("")
      setProjectsError("Project created and assigned to you. You can log time against it now.")
    }catch(cause){setProjectsError(cause instanceof Error?cause.message:"Unable to create project.")}
    finally{setLoading(false)}
  }

  async function saveManualEntries(){
    if(!manualEntries.length||loading||previewOnly||!selectedPeriod)return
    setLoading(true);setError(null)
    try{await onParsed(manualEntries,selectedPeriod.id);setManualEntries([])}
    catch(err){setError(err instanceof Error?err.message:"Failed to save time entries.")}
    finally{setLoading(false)}
  }

  return (
    <section className="border-y border-border bg-card px-1 py-5 sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-none">Create timesheet entries</h2>
            <p className="mt-1 text-xs text-muted-foreground">Enter work directly or extract entries from notes with AI.</p>
          </div>
        </div>
        {(mode==="notes"||previewOnly)&&<div className="flex flex-wrap items-center gap-2">
        <select aria-label="Sample entry count per person" value={sampleCount} disabled={loading} onChange={event=>setSampleCount(event.target.value)} className="rounded-md border border-input bg-white px-2 py-2 text-sm">
          <option value="random">Random (3-18 entries / person)</option>
          <option value="3">3 entries / person</option>
          <option value="6">6 entries / person</option>
          <option value="12">12 entries / person</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSample}
          help="Load synthetic sample notes scoped to your role. Samples are not proof of actual work."
          disabled={loading}
        >
          <WandSparkles className="size-3.5" aria-hidden="true" />
          Try a sample
        </Button>
        </div>}
      </div>

      {!previewOnly&&<label className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs font-semibold text-indigo-950">Timesheet period
        <select aria-label="Entry timesheet period" value={periodId} disabled={periodsLoading||manualEntries.length>0} onChange={event=>{const nextId=event.target.value,next=periods.find(period=>period.id===nextId);setPeriodId(nextId);if(next&&(workDate<next.startDate||workDate>next.endDate))setWorkDate(next.startDate);setError(null)}} className="h-9 min-w-52 rounded-md border border-indigo-200 bg-white px-2 text-sm font-normal text-slate-900">
          <option value="">Select a configured period</option>
          {periods.map(period=><option key={period.id} value={period.id}>{period.name} · {period.startDate} to {period.endDate}</option>)}
        </select>
        {periodsLoading?<span className="font-normal">Loading periods…</span>:periodsError?<span role="alert" className="font-normal text-red-800">{periodsError}</span>:!periods.length?<span role="status" className="font-normal text-red-800">No period is configured. Ask an admin or account manager to create one.</span>:selectedPeriod?<span className="font-normal text-indigo-800">Entries will be limited to {selectedPeriod.startDate}–{selectedPeriod.endDate}.</span>:<span className="font-normal text-orange-900">Select the work period before logging time.</span>}
        {manualEntries.length>0&&<span className="font-normal text-slate-600">Clear queued manual rows before switching periods.</span>}
      </label>}

      {!previewOnly&&<div role="group" aria-label="Entry creation method" className="mb-4 flex w-fit gap-1 border-b border-slate-200">
        <button type="button" aria-pressed={mode==="manual"} onClick={()=>{setMode("manual");setError(null)}} className={`border-b-2 px-3 py-2 text-sm font-medium ${mode==="manual"?"border-orange-600 text-orange-900":"border-transparent text-slate-600 hover:text-slate-950"}`}>Manual entry</button>
        <button type="button" aria-pressed={mode==="notes"} onClick={()=>{setMode("notes");setError(null)}} className={`border-b-2 px-3 py-2 text-sm font-medium ${mode==="notes"?"border-blue-600 text-blue-900":"border-transparent text-slate-600 hover:text-slate-950"}`}>AI notes</button>
      </div>}

      {mode==="manual"&&!previewOnly?<>
        <form onSubmit={addManualEntry} className="grid gap-3 rounded-md border border-orange-200 bg-orange-50/50 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-slate-700">Work date<input required type="date" min={selectedPeriod?.startDate} max={selectedPeriod?.endDate} value={workDate} onChange={event=>setWorkDate(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-700">Assigned project<select required value={project} onChange={event=>setProject(event.target.value)} disabled={projectsLoading||projects.length===0} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">{projectsLoading?"Loading assigned projects…":"Select an assigned project"}</option>{projects.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium text-slate-700">Hours<input required type="number" min="0.25" max="24" step="0.25" value={hours} onChange={event=>setHours(event.target.value)} placeholder="e.g. 7.5" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-700 sm:col-span-2 xl:col-span-1">Work description<input maxLength={1000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="What work was completed?" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4"><Button type="submit" variant="outline" disabled={!selectedPeriod||periodsLoading||!!periodsError||!project}><Plus className="size-4"/>Add to timesheet</Button>{projects.length===0&&!projectsLoading&&<span className="text-xs text-orange-900">Your manager must assign a project before you can log time.</span>}</div>
        </form>
        {canCreateProjects&&<form className="mt-2 flex flex-wrap items-end gap-2 border-l-2 border-sky-500 bg-sky-50/60 px-3 py-2" onSubmit={event=>{event.preventDefault();void createProject()}}><label className="grid gap-1 text-xs font-medium text-slate-700">Create a project<input maxLength={120} value={newProjectName} onChange={event=>setNewProjectName(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="New project"/></label><Button type="submit" size="sm" variant="outline" disabled={loading||!newProjectName.trim()}><Plus className="size-4"/>Create project</Button></form>}
        {projectsError&&<p role="status" className="mt-2 text-xs text-orange-900">{projectsError}</p>}
        {manualEntries.length>0&&<div className="mt-3 overflow-hidden rounded-md border border-sky-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50 px-3 py-2"><p className="text-sm font-semibold">Entries to save <span className="text-slate-600">({manualEntries.length})</span></p><Button type="button" onClick={()=>void saveManualEntries()} disabled={loading}>{loading?<Loader2 className="size-4 animate-spin"/>:<Sparkles className="size-4"/>}{loading?"Saving…":"Save entries"}</Button></div>
          <ul className="divide-y divide-slate-100">{manualEntries.map((entry,index)=><li key={`${entry.date}:${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 break-words">{entry.date} · {entry.project} · {entry.hours}h{entry.description?` · ${entry.description}`:""}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove entry ${index+1}`} onClick={()=>setManualEntries(previous=>previous.filter((_,row)=>row!==index))}><Trash2 className="size-4"/></Button></li>)}</ul>
        </div>}
        {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </>:<>

      <label htmlFor="notes" className="sr-only">
        Time worked notes
      </label>
      {!previewOnly&&<label className="mb-2 grid max-w-xl gap-1 text-xs font-medium text-slate-700">Project assignment
        <select aria-label="Project assignment for extracted entries" value={aiProjectChoice} onChange={event=>{const choice=event.target.value;setAiProjectChoice(choice);setParsedEntries(previous=>previous.map((entry,index)=>({...entry,project:choice==="__notes__"?(projectNamesFromNotes[index]??entry.project):choice})))}} disabled={loading} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal">
          <option value="__notes__">Use projects from notes</option>
          {projects.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}
        </select>
      </label>}
      <textarea
        id="notes"
        value={notes}
        readOnly={sampleIsPreview}
        onChange={(e) => {setNotes(e.target.value);setParsedEntries([]);setProjectNamesFromNotes([]);setError(null)}}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault()
            handleParse()
          }
        }}
        rows={6}
        placeholder="e.g. Maria worked Mon 9-5 on Acme, Tue a half day. Deepak did two full days on the Northwind API…"
        className="max-h-[50dvh] min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {error ? (
            <span role="alert" className="text-destructive">{error}</span>
          ) : sampleIsPreview ? (
            <span>Display-only sample. Clear it before entering real timesheet notes.</span>
          ) : (
            <>
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.65rem]">
                ⌘/Ctrl + Enter
              </kbd>{" "}
              to extract
            </>
          )}
        </p>
        {sampleLoaded&&<Button variant="outline" disabled={loading} onClick={()=>{setNotes("");setSampleLoaded(false);setSampleIsPreview(false);setParsedEntries([]);setProjectNamesFromNotes([]);setError(null)}}>Clear sample</Button>}
        {!previewOnly&&<Button onClick={handleParse} disabled={loading || !notes.trim()||!selectedPeriod||periodsLoading||!!periodsError||sampleIsPreview} size="lg">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Extracting…
            </>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden="true" />
              Extract entries
            </>
          )}
        </Button>}
      </div>
      {parsedEntries.length>0&&<section aria-label="Extracted timesheet preview" className="mt-4 overflow-hidden rounded-md border border-sky-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50 px-3 py-2"><h3 className="text-sm font-semibold">Extracted preview <span className="font-normal text-slate-600">({parsedEntries.length})</span></h3><Button type="button" disabled={loading} onClick={()=>void saveParsedEntries()}>{loading?<Loader2 className="size-4 animate-spin"/>:<Plus className="size-4"/>}{loading?"Saving…":"Save entries"}</Button></header>
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain">{parsedEntries.map((entry,index)=><li key={entry.date+":"+index} className="grid gap-2 px-3 py-2 sm:grid-cols-[7rem_minmax(12rem,1fr)_auto] sm:items-center">
          <span className="text-xs tabular-nums text-slate-600">{entry.date} · {entry.hours}h</span>
          <label className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600">Project<input aria-label={"Project for entry "+(index+1)} maxLength={120} value={entry.project} onChange={event=>setParsedEntries(previous=>previous.map((item,row)=>row===index?{...item,project:event.target.value}:item))} className="h-8 min-w-0 rounded border border-slate-300 px-2 text-sm font-normal text-slate-950"/></label>
          <span className="min-w-0 break-words text-xs text-slate-700">{entry.description||"No description"}</span>
        </li>)}</ul>
      </section>}
      </>}
    </section>
  )
}
