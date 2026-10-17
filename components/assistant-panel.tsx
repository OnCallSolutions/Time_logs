/**
 * Provides an AI work assistant for scoped questions and confirmed workspace actions.
 * Replies remain plain text; proposed actions use a closed, server-signed vocabulary.
 * The UI never renders model output as HTML or runs generated code.
 */
"use client"
import { useState } from "react"
import { Check, LoaderCircle, Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type { AssistantAction, AssistantProposal } from "@/lib/assistant-contract"
type ChatMessage = { role: "user" | "assistant"; content: string }
type Props = { onNavigate:(destination:string)=>void;onRefresh:()=>void;messageContext:string;onContextUsed:()=>void;onCompose:(draft:{recipient:string;body:string;confirmed:boolean})=>void }

/** @param props - Authorized client actions and optional user-shared message context. @returns JSX.Element with responsive conversation and confirmation controls. */
export function AssistantPanel({onNavigate,onRefresh,messageContext,onContextUsed,onCompose}:Props) {
  const [messages,setMessages]=useState<ChatMessage[]>([]),[proposals,setProposals]=useState<AssistantProposal[]>([])
  const [question,setQuestion]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("")
  /** @returns Promise<void> after a bounded server request returns an answer and signed proposals. */
  async function ask():Promise<void>{
    const prompt=question.trim();if(!prompt||busy)return
    const next=[...messages,{role:"user" as const,content:prompt}].slice(-10)
    setQuestion("");setMessages(next);setProposals([]);setNotice("");setError("");setBusy(true)
    try{
      const response=await fetch(apiPath("/api/assistant"),{method:"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:next,messageContext:messageContext||undefined})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Assistant unavailable.")
      setMessages(previous=>[...previous,{role:"assistant" as const,content:String(data.answer)}].slice(-12));setProposals(data.proposals||[])
      if(messageContext)onContextUsed()
      if(data.totalVisible>data.included)setNotice(`Answer uses ${data.included} of ${data.totalVisible} visible entries.`)
    }catch(cause){setError(cause instanceof Error?cause.message:"Assistant unavailable.")}
    finally{setBusy(false)}
  }
  /** @param proposal - One visible signed proposal explicitly approved by the user. @returns Promise<void> after server confirmation and local refresh. */
  async function confirm(proposal:AssistantProposal):Promise<void>{
    if(busy)return;setBusy(true);setError("")
    try{
      const response=await fetch(apiPath("/api/assistant/actions"),{method:"POST",cache:"no-store",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({token:proposal.token})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Action could not be confirmed.")
      const action=data.clientAction as AssistantAction|undefined
      if(action?.kind==="navigate")onNavigate(action.destination)
      else if(action?.kind==="compose_message"){onCompose({recipient:action.recipient,body:action.body,confirmed:true});onNavigate("messages")}
      else onRefresh()
      setProposals(current=>current.filter(item=>item.token!==proposal.token));setNotice(action?.kind==="compose_message"?"Message draft opened. Review and send it from Messages.":"Action confirmed.")
    }catch(cause){setError(cause instanceof Error?cause.message:"Action could not be confirmed.")}
    finally{setBusy(false)}
  }
  function describe(action:AssistantAction):string{
    if(action.kind==="navigate")return `Open ${action.destination.replaceAll("_"," ")}`
    if(action.kind==="create_entries")return `Create ${action.entries.length} draft ${action.entries.length===1?"entry":"entries"}`
    if(action.kind==="edit_entry")return `Edit timesheet ${action.id.slice(0,8)}`
    if(action.kind==="delete_entry")return `Delete timesheet ${action.id.slice(0,8)}`
    if(action.kind==="compose_message")return `Prepare message to ${action.recipient}`
    if(action.kind==="mark_messages_read")return `Mark ${action.ids.length} ${action.ids.length===1?"message":"messages"} as read`
    if(action.kind==="delete_message")return `Delete message ${action.id.slice(0,8)}`
    if(action.kind==="update_rights")return `Change rights for ${action.email}`
    return `${action.status[0].toUpperCase()+action.status.slice(1)} timesheet ${action.id.slice(0,8)}`
  }
  return <section aria-label="Tanovo assistant" className="mx-auto flex min-h-[min(78dvh,52rem)] w-full max-w-5xl flex-col overflow-hidden border bg-white">
    <header className="flex shrink-0 items-center gap-3 border-b bg-orange-50 px-4 py-3"><span className="flex size-9 items-center justify-center rounded-md bg-orange-600 text-white"><Sparkles className="size-5"/></span><div><h2 className="font-semibold">Tanovo assistant</h2><p className="text-xs text-muted-foreground">Timesheet help, review suggestions and workspace actions</p></div></header>
    <div aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
      {!messages.length&&<p className="max-w-2xl text-sm text-muted-foreground">Ask about timesheets, request draft entries, or ask me to open a workspace. I’ll show proposed changes for you to confirm.</p>}
      {messages.map((message,index)=><article key={`${index}:${message.role}`} className={`max-w-[88%] whitespace-pre-wrap break-words rounded-md border p-3 text-sm ${message.role==="user"?"ml-auto border-orange-200 bg-orange-50":"mr-auto border-zinc-200 bg-white"}`}><p>{message.content}</p></article>)}
      {proposals.map(proposal=><article key={proposal.token} className="mr-auto w-full max-w-2xl border-l-4 border-orange-500 bg-zinc-50 p-3"><p className="text-sm font-medium">{describe(proposal.action)}</p>{proposal.action.kind==="create_entries"&&<ul className="my-2 max-h-40 overflow-auto text-xs">{proposal.action.entries.map((entry,index)=><li key={`${index}:${entry.date}`} className="py-1">{entry.date} · {entry.project} · {entry.hours}h · {entry.description}</li>)}</ul>}{proposal.action.kind==="edit_entry"&&<dl className="my-2 space-y-1 text-sm">{Object.entries(proposal.action.fields).map(([field,value])=><div key={field}><dt className="inline font-medium">{field}: </dt><dd className="inline">{String(value)}</dd></div>)}</dl>}{proposal.action.kind==="update_entry"&&<p className="my-2 text-sm">{proposal.action.reviewNote}</p>}{proposal.action.kind==="update_rights"&&<p className="my-2 text-sm">{Object.entries(proposal.action.permissions).map(([key,value])=>`${key.replaceAll("_"," ")}: ${value?"allow":"deny"}`).join(" · ")}</p>}{proposal.action.kind==="compose_message"&&<p className="my-2 whitespace-pre-wrap break-words text-sm">{proposal.action.body}</p>}<Button size="sm" variant={proposal.action.kind==="delete_entry"||proposal.action.kind==="delete_message"?"destructive":"default"} disabled={busy} onClick={()=>void confirm(proposal)}><Check className="size-4"/>{proposal.action.kind==="compose_message"?"Confirm and send securely":"Confirm action"}</Button></article>)}
      {busy&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>Working...</p>}{notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
    <form onSubmit={event=>{event.preventDefault();void ask()}} className="flex shrink-0 items-end gap-2 border-t bg-white p-3"><label className="sr-only" htmlFor="assistant-question">Ask Tanovo assistant</label><textarea id="assistant-question" value={question} disabled={busy} maxLength={6000} rows={2} onChange={event=>setQuestion(event.target.value)} placeholder="Ask about your timesheets or request an action" className="min-h-12 min-w-0 flex-1 resize-y rounded-md border p-3 text-sm"/><Button aria-label="Send to assistant" disabled={busy||!question.trim()}><Send className="size-4"/><span className="sr-only">Send</span></Button></form>
  </section>
}
