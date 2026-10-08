/**
 * Provides compact message composition, receipts, editing, and confirmed deletion.
 * Read acknowledgments are sent only after incoming messages are explicitly opened.
 * Edit deadlines come from shared policy and are enforced again by the server.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { Check, CheckCheck, LockKeyhole, Pencil, RefreshCw, Save, Send, Trash2, X } from "lucide-react"
import { useMessageEncryption } from "@/components/use-message-encryption"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { useMessageInbox, type MessageInbox } from "@/components/use-message-inbox"
import { apiPath } from "@/lib/paths"
import { canEditMessage, MESSAGE_EDIT_MINUTES, type AppMessage } from "@/lib/message-policy"

/**
 * Renders inbox controls and message lifecycle actions for current permissions.
 * @param props.canSend - Whether the account may compose employee messages.
 * @param props.inbox - Optional shell-owned inbox for persistent notifications.
 * @returns JSX.Element containing the authorized message workspace.
 */
export function MessagesPanel({canSend,inbox}:{canSend:boolean;inbox?:MessageInbox}) {
  const local = useMessageInbox(!inbox)
  const state = inbox ?? local
  const encryption=useMessageEncryption(state.email,state.messages)
  const [passphrase,setPassphrase]=useState("")
  const [confirmation,setConfirmation]=useState("")
  const [users,setUsers] = useState<{email:string}[]>([])
  const [recipient,setRecipient] = useState("")
  const [body,setBody] = useState("")
  const [error,setError] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const [editing,setEditing] = useState<AppMessage|null>(null)
  const [draft,setDraft] = useState("")
  const [deleting,setDeleting] = useState<AppMessage|null>(null)
  const [now,setNow] = useState(Date.now())
  const [readIds,setReadIds] = useState<Set<string>>(new Set())
  const operation=useRef(false)
  useEffect(() => {
    const timer = window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[])
  useEffect(() => {
    if(!canSend)return
    const controller=new AbortController()
    fetch(apiPath("/api/delegation"),{cache:"no-store",signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setUsers(data.users)})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[canSend])
  /**
   * Submits an explicit message mutation without optimistic success indicators.
   * @param method - HTTP method for sending, editing, or deleting.
   * @param payload - Validated action fields sent to the scoped API.
   * @returns Promise<boolean> indicating confirmed server success.
   */
  async function mutate(method:string,payload:object):Promise<boolean> {
    setBusy(true);setError(null)
    try {
      const response=await fetch(apiPath("/api/messages"),{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
      const data=await response.json();if(!response.ok)throw new Error(data.error || "Message action failed.")
      state.refresh();return true
    } catch(error){setError(error instanceof Error?error.message:"Message action failed.");return false}
    finally{setBusy(false)}
  }
  /**
   * Records an incoming message as read when opened in a visible browser tab.
   * @param message - Opened message; sender identities cannot acknowledge themselves.
   * @returns Promise<void> after receipt confirmation or a retryable error.
   */
  async function read(message:AppMessage):Promise<void> {
    if(document.visibilityState!=="visible" || (message.encrypted_payload&&!encryption.plaintext[message.id]) || message.deleted_at || message.read_at || readIds.has(message.id) || message.sender_email.toLowerCase()===state.email)return
    try {
      const response=await fetch(apiPath("/api/messages"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read",ids:[message.id]})})
      if(!response.ok)throw new Error("Unable to mark message read.")
      setReadIds(previous=>new Set([...previous,message.id]));state.refresh()
    }catch(error){setError(error instanceof Error?error.message:"Receipt unavailable.")}
  }
  /** @returns Promise<void> after encrypting and sending the composed message. */
  async function send():Promise<void>{
    if(operation.current)return
    operation.current=true;setBusy(true);setError(null)
    try{
      const encrypted=await encryption.encrypt(body,recipient||null,[state.email,...(recipient?[recipient]:users.map(user=>user.email))])
      if(await mutate("POST",{recipient:recipient||null,encrypted}))setBody("")
    }catch(error){setError(error instanceof Error?error.message:"Unable to encrypt message.")}
    finally{operation.current=false;setBusy(false)}
  }
  /** @returns Promise<void> after saving authenticated encrypted edits to the original participant set. */
  async function saveEdit():Promise<void>{
    if(!editing||operation.current)return
    operation.current=true;setBusy(true);setError(null)
    try{
      const payload=editing.encrypted_payload?{encrypted:await encryption.encrypt(draft,editing.recipient_email,Object.keys(editing.encrypted_payload.keys),editing.sender_email)}:{body:draft}
      if(await mutate("PATCH",{action:"edit",id:editing.id,...payload}))setEditing(null)
    }catch(error){setError(error instanceof Error?error.message:"Unable to encrypt edit.")}
    finally{operation.current=false;setBusy(false)}
  }
  return <section aria-label="Messages" className="space-y-3">
    <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Messages <span className="text-xs text-muted-foreground">{state.unread ? `${state.unread} unread` : ""}</span></h2><Button size="icon-sm" variant="outline" title="Refresh inbox" aria-label="Refresh inbox" onClick={state.refresh}><RefreshCw className="size-4"/></Button></div>
    {(error||state.error)&&<p role="alert" className="text-sm text-destructive">{error||state.error}</p>}
    <div className="border-y border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary"/>{encryption.unlocked?"Messaging encryption unlocked":"Messaging encryption locked"}</p>{encryption.unlocked&&<Button size="sm" variant="outline" onClick={encryption.lock}>Lock messages</Button>}</div>
      {encryption.error&&<p role="alert" className="mt-2 text-sm text-destructive">{encryption.error}</p>}
      {!encryption.unlocked&&encryption.loaded&&<form className="mt-3 grid max-w-lg gap-2" onSubmit={async event=>{event.preventDefault();if(!encryption.own&&passphrase!==confirmation){setError("Recovery passphrases must match.");return}if(await encryption.unlock(passphrase)){setPassphrase("");setConfirmation("")}}}>
        <label className="text-sm">Recovery passphrase<input type="password" autoComplete="off" minLength={encryption.own?1:16} required value={passphrase} onChange={event=>setPassphrase(event.target.value)} className="mt-1 block w-full rounded-md border p-2"/></label>
        {!encryption.own&&<><label className="text-sm">Confirm recovery passphrase<input type="password" autoComplete="off" minLength={16} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="mt-1 block w-full rounded-md border p-2"/></label><p className="text-xs text-muted-foreground">Use at least 16 characters. Keep this separate from your Microsoft password. Losing it means losing access to encrypted messages.</p></>}
        <Button type="submit" className="w-fit" disabled={encryption.busy}>{encryption.busy?"Unlocking...":encryption.own?"Unlock messages":"Set up encryption"}</Button>
      </form>}
      {encryption.own&&<details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Encryption identities</summary><p className="my-2 text-muted-foreground">Compare fingerprints with participants using another trusted channel.</p>{encryption.keys.map(key=><p key={key.email} className="mb-2 break-all"><span className="font-medium">{key.email}</span><br/>{key.fingerprint}</p>)}</details>}
    </div>
    {canSend&&<details className="border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">New message</summary><div className="grid gap-3 pt-3">
      <label className="text-sm">Recipient<select value={recipient} disabled={busy} onChange={event=>setRecipient(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="">All employees</option>{users.map(user=><option key={user.email} value={user.email}>{user.email}</option>)}</select></label>
      <label className="text-sm">Message<textarea value={body} disabled={busy} maxLength={4000} onChange={event=>setBody(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border border-border bg-background p-2"/></label>
      <Button className="w-fit" disabled={busy||!body.trim()||!encryption.unlocked} onClick={send}><Send className="size-4"/>{busy?"Sending...":"Send message"}</Button>
    </div></details>}
    {state.loading&&<p role="status" className="text-sm text-muted-foreground">Loading messages...</p>}
    {!state.loading&&!state.messages.length&&<p className="text-sm text-muted-foreground">No messages yet.</p>}
    <div className="max-h-[60dvh] overflow-auto overscroll-contain">{state.messages.map(message=>{
      const own=message.sender_email.toLowerCase()===state.email
      const text=message.encrypted_payload?encryption.plaintext[message.id]??"Encrypted message · unlock to read":message.body
      const editable=(canSend||state.admin)&&(!message.encrypted_payload||!!encryption.plaintext[message.id])&&canEditMessage(message,state.email,state.admin,now)
      return <details key={message.id} className="border-b border-border py-3" onToggle={event=>{if(event.currentTarget.open)void read(message)}}>
        <summary className="cursor-pointer break-words text-sm"><span className="font-medium">{message.sender_email} → {message.recipient_email ?? "All employees"}</span><time className="ml-2 text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time>
          {!own&&!message.read_at&&!readIds.has(message.id)&&!message.deleted_at&&<span className="ml-2 inline-block size-2 rounded-full bg-primary" aria-label="Unread message"/>}
          <span className="mt-1 block truncate text-muted-foreground">{message.deleted_at?"Message deleted":text.slice(0,120)}</span>
          {!message.deleted_at&&<span className="text-xs text-muted-foreground">{message.encrypted_payload?"End-to-end encrypted · ":"Legacy plaintext message · "}</span>}
          {message.edited_at&&!message.deleted_at&&<span className="text-xs text-muted-foreground">Edited{message.encrypted_payload?.author!==message.sender_email&&message.encrypted_payload?.author?` by ${message.encrypted_payload.author}`:""} · </span>}
          {own&&!message.deleted_at&&<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{message.read_at||message.read_count ? <CheckCheck className="size-3 text-primary"/> : message.delivered_at||message.delivered_count ? <CheckCheck className="size-3"/> : <Check className="size-3"/>}{message.recipient_email ? message.read_at?"Read":message.delivered_at?"Delivered":"Sent" : `Sent · Delivered to ${message.delivered_count??0} · Read by ${message.read_count??0}`}</span>}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.deleted_at?"Message deleted":text}</p>
        {!message.deleted_at&&<div className="mt-2 flex flex-wrap gap-2">
          {editable&&<Button variant="outline" size="sm" onClick={()=>{setEditing(message);setDraft(text)}}><Pencil className="size-3"/>Edit message</Button>}
          {(state.admin||(own&&canSend))&&<Button variant="outline" size="sm" onClick={()=>setDeleting(message)}><Trash2 className="size-3"/>Delete message</Button>}
          {own&&!state.admin&&!editable&&<p className="text-xs text-muted-foreground">Editing closed after {MESSAGE_EDIT_MINUTES} minutes.</p>}
        </div>}
      </details>
    })}</div>
    {editing&&<WindowSurface title="Edit message" onBack={()=>setEditing(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-3xl flex-col bg-white">
      <h2 className="border-b p-4 font-semibold">Edit message</h2><div className="min-h-0 flex-1 overflow-auto p-4"><label className="text-sm">Message<textarea className="mt-2 min-h-40 w-full rounded-md border p-3" value={draft} maxLength={4000} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      <div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setEditing(null)}><X className="size-4"/>Cancel</Button><Button disabled={busy||!draft.trim()||!canEditMessage(editing,state.email,state.admin,now)} onClick={saveEdit}><Save className="size-4"/>{busy?"Saving...":"Save message"}</Button></div>
    </section></WindowSurface>}
    {deleting&&<WindowSurface title="Delete message" onBack={()=>setDeleting(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-xl flex-col bg-white"><h2 className="border-b p-4 font-semibold">Delete message</h2><div className="min-h-0 flex-1 overflow-auto p-4"><p className="text-sm">Delete this message for everyone? Its content will be replaced with a deletion marker.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div><div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async()=>{if(await mutate("DELETE",{id:deleting.id}))setDeleting(null)}}><Trash2 className="size-4"/>{busy?"Deleting...":"Delete for everyone"}</Button></div></section></WindowSurface>}
  </section>
}
