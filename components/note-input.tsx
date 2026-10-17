"use client"

/**
 * Provides the note input surface that submits free-form text for AI parsing.
 *
 * The input lets users paste informal notes, keyboard-submit them, or load a
 * sample. It owns transient parsing state and delegates persisted entry handling
 * to its parent through the onParsed callback.
 */
import { useEffect, useState, type FormEvent } from "react"
import { Loader2, Plus, Sparkles, Trash2, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry } from "@/lib/types"

type EntryPeriod={id:string;name:string;startDate:string;endDate:string}

/**
 * Captures messy time notes and sends them to the parser API.
 *
 * This component does not save entries directly. It only asks the parser API to
 * turn free-form text into structured entries, then hands those entries to the
 * parent so the main workspace can persist them.
 *
 * @param props - Component props.
 * @param props.onParsed - Callback invoked with parsed entries after extraction.
 * @returns The note entry form and parse controls.
 */
export function NoteInput({
  onParsed,
  previewOnly=false,
}: {
  onParsed: (entries: ParsedEntry[],periodId:string) => void | Promise<void>
  previewOnly?:boolean
}) {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sampleCount, setSampleCount] = useState("random")
  const [sampleIsPreview, setSampleIsPreview] = useState(false)
  const [mode,setMode]=useState<"manual"|"notes">("manual")
  const [workDate,setWorkDate]=useState(()=>{const today=new Date();return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`})
  const [project,setProject]=useState("")
  const [hours,setHours]=useState("")
  const [description,setDescription]=useState("")
  const [manualEntries,setManualEntries]=useState<ParsedEntry[]>([])
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
  const selectedPeriod=periods.find(period=>period.id===periodId)
  /**
   * Loads synthetic examples scoped by the authenticated server identity.
   * @returns Promise<void> after replacing notes or displaying a safe error.
   */
  async function loadSample(){
    setMode("notes");setLoading(true);setError(null)
    try{const response=await fetch(apiPath(`/api/samples?count=${sampleCount}`),{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error);setNotes(data.notes);setSampleIsPreview(!!data.previewOnly)}
    catch(error){setError(error instanceof Error?error.message:"Samples unavailable.")}finally{setLoading(false)}
  }

  /**
   * Parses the current notes and forwards any extracted entries to the parent.
   *
   * The handler blocks duplicate submissions while loading, displays parser errors
   * inline, and clears the text area only after the parent callback accepts the
   * extracted entries.
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
        await onParsed(entries,selectedPeriod.id)
        setNotes("")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse notes.")
    } finally {
      setLoading(false)
    }
  }

  function addManualEntry(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(!selectedPeriod||workDate<selectedPeriod.startDate||workDate>selectedPeriod.endDate){setError("Choose a work date inside the selected timesheet period.");return}
    const value=Number(hours)
    if(!Number.isFinite(value)||value<=0||value>24)return
    setManualEntries(previous=>[...previous,{contractor:"Self",date:workDate,hours:value,project:project.trim()||"General",description:description.trim()}])
    setProject("");setHours("");setDescription("")
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
          <label className="grid gap-1 text-xs font-medium text-slate-700">Project<input maxLength={120} value={project} onChange={event=>setProject(event.target.value)} placeholder="General" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-700">Hours<input required type="number" min="0.25" max="24" step="0.25" value={hours} onChange={event=>setHours(event.target.value)} placeholder="e.g. 7.5" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <label className="grid gap-1 text-xs font-medium text-slate-700 sm:col-span-2 xl:col-span-1">Work description<input maxLength={1000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="What work was completed?" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"/></label>
          <div className="flex items-end sm:col-span-2 xl:col-span-4"><Button type="submit" variant="outline" disabled={!selectedPeriod||periodsLoading||!!periodsError}><Plus className="size-4"/>Add to timesheet</Button></div>
        </form>
        {manualEntries.length>0&&<div className="mt-3 overflow-hidden rounded-md border border-sky-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50 px-3 py-2"><p className="text-sm font-semibold">Entries to save <span className="text-slate-600">({manualEntries.length})</span></p><Button type="button" onClick={()=>void saveManualEntries()} disabled={loading}>{loading?<Loader2 className="size-4 animate-spin"/>:<Sparkles className="size-4"/>}{loading?"Saving…":"Save entries"}</Button></div>
          <ul className="divide-y divide-slate-100">{manualEntries.map((entry,index)=><li key={`${entry.date}:${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 break-words">{entry.date} · {entry.project} · {entry.hours}h{entry.description?` · ${entry.description}`:""}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove entry ${index+1}`} onClick={()=>setManualEntries(previous=>previous.filter((_,row)=>row!==index))}><Trash2 className="size-4"/></Button></li>)}</ul>
        </div>}
        {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </>:<>

      <label htmlFor="notes" className="sr-only">
        Time worked notes
      </label>
      <textarea
        id="notes"
        value={notes}
        readOnly={sampleIsPreview}
        onChange={(e) => setNotes(e.target.value)}
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
            <span className="text-destructive">{error}</span>
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
        {sampleIsPreview&&<Button variant="outline" disabled={loading} onClick={()=>{setNotes("");setSampleIsPreview(false)}}>Clear sample</Button>}
        {!previewOnly&&!sampleIsPreview&&<Button onClick={handleParse} disabled={loading || !notes.trim()||!selectedPeriod||periodsLoading||!!periodsError} size="lg">
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
      </>}
    </section>
  )
}
