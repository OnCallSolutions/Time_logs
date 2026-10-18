/**
 * Provides an AI work assistant for scoped questions and confirmed workspace actions.
 * Replies remain plain text; proposed actions use a closed, server-signed vocabulary.
 * The UI never renders model output as HTML or runs generated code.
 */
"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { AlertTriangle, Check, LoaderCircle, Pin, PinOff, Send, Sparkles, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { AssistantAction, AssistantProposal } from "@/lib/assistant-contract"
import type { AssistantWindowControls } from "@/components/window-assistant-context"
type ChatMessage = { role: "user" | "assistant"; content: string }
type AssistantPeriod={id:string;name:string;startDate:string;endDate:string}
type Props = { organizationName?:string;workspaceContext?:string;handoffContext?:string;onClose?:()=>void;onDragStart?:(event:ReactPointerEvent<HTMLElement>)=>void;onDragMove?:(event:ReactPointerEvent<HTMLElement>)=>void;onDragEnd?:(event:ReactPointerEvent<HTMLElement>)=>void;docked?:boolean;onToggleDock?:()=>void;onNavigate:(destination:string,handoff?:string)=>void;onHandoffUsed?:()=>void;onRefresh:()=>void;messageContext:string;onContextUsed:()=>void;onCompose:(draft:{recipient:string;body:string;confirmed:boolean})=>void;focusRequest?:number;onPreferredHeight?:(height:number)=>void }

/** @param props - Authorized client actions and optional user-shared message context. @returns JSX.Element with responsive conversation and confirmation controls. */
export function AssistantPanel({organizationName="DevOnCall",workspaceContext="main",handoffContext,onClose,onDragStart,onDragMove,onDragEnd,docked=true,onToggleDock,onNavigate,onHandoffUsed,onRefresh,messageContext,onContextUsed,onCompose,focusRequest=0,onPreferredHeight}:Props) {
  const [messages,setMessages]=useState<ChatMessage[]>([]),[proposals,setProposals]=useState<AssistantProposal[]>([])
  const [conversationReady,setConversationReady]=useState(false)
  const [question,setQuestion]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("")
  const [deleteConfirmation,setDeleteConfirmation]=useState<AssistantProposal|null>(null)
  const [periods,setPeriods]=useState<AssistantPeriod[]>([]),[periodId,setPeriodId]=useState(""),[periodsReady,setPeriodsReady]=useState(false),[periodError,setPeriodError]=useState("")
  const questionInput=useRef<HTMLTextAreaElement>(null)
  const conversationRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const controller=new AbortController();setConversationReady(false);setError("")
    void fetch(apiPath("/api/assistant/conversations"),{method:"POST",cache:"no-store",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceContext})})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Assistant memory is unavailable.");setMessages(Array.isArray(data.messages)?data.messages:[]);setConversationReady(true)})
      .catch(cause=>{if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:"Assistant memory is unavailable.");setConversationReady(true)}})
    return()=>controller.abort()
  },[workspaceContext])
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Timesheet periods are unavailable.")
      const available:AssistantPeriod[]=Array.isArray(data.periods)?data.periods:[];setPeriods(available)
      const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`
      setPeriodId(available.find(period=>period.startDate<=today&&period.endDate>=today)?.id??"")
    }).catch(cause=>{if(!controller.signal.aborted)setPeriodError(cause instanceof Error?cause.message:"Timesheet periods are unavailable.")}).finally(()=>{if(!controller.signal.aborted)setPeriodsReady(true)})
    return()=>controller.abort()
  },[])
  useEffect(()=>{if(focusRequest>0&&conversationReady)questionInput.current?.focus()},[focusRequest,conversationReady])
  useLayoutEffect(()=>{
    const conversation=conversationRef.current
    if(!conversation||!onPreferredHeight)return
    const update=()=>{
      const section=conversation.closest("section")
      if(!section)return
      const header=section.querySelector("header")?.getBoundingClientRect().height??64
      const composer=section.querySelector("form")?.getBoundingClientRect().height??76
      if(!conversation.scrollHeight&&header<=0&&composer<=0)return
      const available=Math.max(180,window.innerHeight-24)
      const minimum=Math.min(300,available)
      const content=Math.min(conversation.scrollHeight,Math.floor(available*.65))
      onPreferredHeight(Math.min(available,Math.max(minimum,Math.ceil(header+composer+content))))
    }
    update()
    if(typeof ResizeObserver==="undefined")return
    const observer=new ResizeObserver(update)
    observer.observe(conversation)
    return()=>observer.disconnect()
  },[messages,proposals,busy,notice,error,onPreferredHeight])
  /** @returns Promise<void> after a bounded server request returns an answer and signed proposals. */
  async function ask():Promise<void>{
    const prompt=question.trim();if(!prompt||busy)return
    const next=[...messages,{role:"user" as const,content:prompt}].slice(-10)
    setQuestion("");setMessages(next);setProposals([]);setNotice("");setError("");setBusy(true)
    try{
      const response=await fetch(apiPath("/api/assistant"),{method:"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}],workspaceContext,handoffContext:handoffContext||undefined,messageContext:messageContext||undefined,periodId:periodId||undefined})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Assistant unavailable.")
      setMessages(previous=>[...previous,{role:"assistant" as const,content:String(data.answer)}].slice(-12));setProposals(data.proposals||[])
      if(messageContext)onContextUsed()
      if(handoffContext)onHandoffUsed?.()
      if(data.totalVisible>data.included)setNotice(`Answer uses ${data.included} of ${data.totalVisible} visible entries.`)
    }catch(cause){setError(cause instanceof Error?cause.message:"Assistant unavailable.")}
    finally{setBusy(false)}
  }
  /** @param proposal - One visible signed proposal explicitly approved by the user. @returns Promise<void> after server confirmation and local refresh. */
  async function confirm(proposal:AssistantProposal,deleteConfirmed=false):Promise<void>{
    if((proposal.action.kind==="delete_entry"||proposal.action.kind==="delete_message")&&!deleteConfirmed){setDeleteConfirmation(proposal);return}
    if(busy)return;setBusy(true);setError("")
    try{
      const response=await fetch(apiPath("/api/assistant/actions"),{method:"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({token:proposal.token})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Action could not be confirmed.")
      const action=data.clientAction as AssistantAction|undefined
      if(action?.kind==="navigate")onNavigate(action.destination,JSON.stringify({sourceWorkspace:workspaceContext,messages:messages.slice(-4)}).slice(0,4000))
      else if(action?.kind==="compose_message"){onCompose({recipient:action.recipient,body:action.body,confirmed:true});onNavigate("messages")}
      else onRefresh()
      if(deleteConfirmed)setDeleteConfirmation(null)
      setProposals(current=>current.filter(item=>item.token!==proposal.token));setNotice(action?.kind==="compose_message"?"Message draft opened. Review and send it from Messages.":"Action confirmed.")
    }catch(cause){setError(cause instanceof Error?cause.message:"Action could not be confirmed.")}
    finally{setBusy(false)}
  }
  function describe(action:AssistantAction):string{
    if(action.kind==="navigate")return `Open ${action.destination.replaceAll("_"," ")}`
    if(action.kind==="create_entries")return `Create ${action.entries.length} draft ${action.entries.length===1?"entry":"entries"} · ${action.periodName}`
    if(action.kind==="edit_entry")return `Edit timesheet ${action.id.slice(0,8)}`
    if(action.kind==="delete_entry")return `Delete timesheet ${action.id.slice(0,8)}`
    if(action.kind==="compose_message")return `Prepare message to ${action.recipient}`
    if(action.kind==="mark_messages_read")return `Mark ${action.ids.length} ${action.ids.length===1?"message":"messages"} as read`
    if(action.kind==="delete_message")return `Delete message ${action.id.slice(0,8)}`
    if(action.kind==="update_rights")return `Change rights for ${action.email}`
    return `${action.status[0].toUpperCase()+action.status.slice(1)} timesheet ${action.id.slice(0,8)}`
  }
  return <section aria-label={`${organizationName} assistant`} className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-emerald-300/70 bg-white/95 shadow-sm backdrop-blur">
    <header title={onDragStart?"Drag to move assistant window":undefined} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} className={`flex shrink-0 items-center gap-3 border-b border-emerald-200 bg-emerald-50/90 px-4 py-3 ${onDragStart?"touch-none select-none cursor-grab active:cursor-grabbing":""}`}><span className="flex size-9 items-center justify-center rounded-md bg-orange-600 text-white"><Sparkles className="size-5"/></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{organizationName}</h2><p className="text-xs text-muted-foreground">Tanovo Time · {workspaceContext==="main"?"Workspace assistant":`${workspaceContext} assistant`}</p></div>{onToggleDock&&<Button type="button" variant="ghost" size="icon-sm" aria-label={docked?"Undock AI assistant":"Dock AI assistant at bottom right"} title={docked?"Undock assistant":"Dock at bottom right"} onClick={onToggleDock}>{docked?<PinOff className="size-4"/>:<Pin className="size-4"/>}</Button>}{onClose&&<Button variant="ghost" size="icon-sm" aria-label="Close window assistant" onClick={onClose}><X className="size-4"/></Button>}</header>
    <div ref={conversationRef} aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-auto bg-emerald-50/25 p-4">
      {!conversationReady&&<p role="status" className="text-sm text-muted-foreground">Syncing assistant memory...</p>}
      {!messages.length&&conversationReady&&<p className="max-w-2xl text-sm text-muted-foreground">Ask about {workspaceContext==="main"?"your workspace":workspaceContext}, request an action, or ask me to open another workspace. I’ll show proposed changes for you to confirm.</p>}
      {messages.map((message,index)=><article key={`${index}:${message.role}`} className={`max-w-[88%] whitespace-pre-wrap break-words rounded-md border p-3 text-sm ${message.role==="user"?"ml-auto border-orange-200 bg-orange-50":"mr-auto border-zinc-200 bg-white"}`}><p>{message.content}</p></article>)}
      {proposals.map(proposal=><article key={proposal.token} className="mr-auto w-full max-w-2xl border-l-4 border-orange-500 bg-zinc-50 p-3"><p className="text-sm font-medium">{describe(proposal.action)}</p>{proposal.action.kind==="create_entries"&&<ul className="my-2 max-h-40 overflow-auto text-xs">{proposal.action.entries.map((entry,index)=><li key={`${index}:${entry.date}`} className="py-1">{entry.date} · {entry.project} · {entry.hours}h · {entry.description}</li>)}</ul>}{proposal.action.kind==="edit_entry"&&<dl className="my-2 space-y-1 text-sm">{Object.entries(proposal.action.fields).map(([field,value])=><div key={field}><dt className="inline font-medium">{field}: </dt><dd className="inline">{String(value)}</dd></div>)}</dl>}{proposal.action.kind==="update_entry"&&<p className="my-2 text-sm">{proposal.action.reviewNote}</p>}{proposal.action.kind==="update_rights"&&<p className="my-2 text-sm">{Object.entries(proposal.action.permissions).map(([key,value])=>`${key.replaceAll("_"," ")}: ${value?"allow":"deny"}`).join(" · ")}</p>}{proposal.action.kind==="compose_message"&&<p className="my-2 whitespace-pre-wrap break-words text-sm">{proposal.action.body}</p>}<Button size="sm" variant={proposal.action.kind==="delete_entry"||proposal.action.kind==="delete_message"?"destructive":"default"} disabled={busy} onClick={()=>void confirm(proposal)}>{proposal.action.kind==="delete_entry"||proposal.action.kind==="delete_message"?<Trash2 className="size-4"/>:<Check className="size-4"/>}{proposal.action.kind==="compose_message"?"Confirm and send securely":proposal.action.kind==="delete_entry"||proposal.action.kind==="delete_message"?"Review deletion":"Confirm action"}</Button></article>)}
      {busy&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>Working...</p>}{notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
    <form onSubmit={event=>{event.preventDefault();void ask()}} className="flex shrink-0 flex-col gap-2 border-t border-emerald-200 bg-white p-3"><label className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-emerald-950">Timesheet period<select aria-label="Assistant timesheet period" value={periodId} disabled={!periodsReady||busy} onChange={event=>setPeriodId(event.target.value)} className="h-7 min-w-40 max-w-full rounded-md border border-emerald-200 bg-white px-2 text-xs font-normal text-slate-900"><option value="">Select a configured period</option>{periods.map(period=><option key={period.id} value={period.id}>{period.name} · {period.startDate}–{period.endDate}</option>)}</select>{periodError?<span role="status" className="font-normal text-red-800">{periodError}</span>:!periodsReady?<span className="font-normal text-slate-600">Loading periods…</span>:!periods.length?<span className="font-normal text-orange-900">No period configured for time logging.</span>:null}</label><div className="flex items-end gap-2"><label className="sr-only" htmlFor="assistant-question">Ask {organizationName}</label><textarea ref={questionInput} id="assistant-question" value={question} disabled={busy||!conversationReady} maxLength={6000} rows={2} onChange={event=>setQuestion(event.target.value)} placeholder={!conversationReady?"Syncing assistant memory...":`Ask about ${workspaceContext==="main"?"your timesheets or request an action":`${workspaceContext} or request an action`}`} className="min-h-12 min-w-0 flex-1 resize-y rounded-md border p-3 text-sm"/><Button type="submit" aria-label="Send to assistant" disabled={busy||!conversationReady||!question.trim()}><Send className="size-4"/><span className="sr-only">Send</span></Button></div></form>
    {deleteConfirmation&&<WindowSurface title="Confirm AI-proposed deletion" compact resizable assistant={false} disabled={busy} onBack={()=>{if(!busy){setDeleteConfirmation(null);setError("")}}}><section className="flex w-full max-w-xl flex-col bg-white text-slate-950"><header className="flex items-start gap-3 border-b border-red-200 bg-red-50 p-4"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-700"/><div><h2 className="font-semibold text-red-950">Confirm this deletion</h2><p className="mt-1 text-sm text-red-900">The assistant will not delete anything until you confirm here.</p></div></header><p className="p-4 text-sm">{describe(deleteConfirmation.action)}. This action cannot be undone.</p>{error&&<p role="alert" className="px-4 pb-3 text-sm text-red-700">{error}</p>}<footer className="flex justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>{setDeleteConfirmation(null);setError("")}}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={()=>void confirm(deleteConfirmation,true)}><Trash2 className="size-4"/>{busy?"Deleting...":"Delete permanently"}</Button></footer></section></WindowSurface>}
  </section>
}
