/**
 * Provides compact message composition, receipts, editing, and confirmed deletion.
 * Read acknowledgments are sent only after incoming messages are explicitly opened.
 * Edit deadlines come from shared policy and are enforced again by the server.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { Check, CheckCheck, LockKeyhole, Pencil, RefreshCw, Save, Send, Trash2, X, Settings, Search } from "lucide-react"
import { useMessageEncryption } from "@/components/use-message-encryption"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { useMessageInbox, type MessageInbox } from "@/components/use-message-inbox"
import { apiPath } from "@/lib/paths"
import { audienceEmails,type MessageAudience } from "@/lib/message-audience"
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
  const [users,setUsers] = useState<{email:string;role:string;accessStatus:string}[]>([])
  const [audience,setAudience]=useState<MessageAudience>("workforce")
  const [rosterLoading,setRosterLoading]=useState(canSend)
  const [recipient,setRecipient] = useState("")
  const [body,setBody] = useState("")
  const [error,setError] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const [editing,setEditing] = useState<AppMessage|null>(null)
  const [draft,setDraft] = useState("")
  const [deleting,setDeleting] = useState<AppMessage|null>(null)
  const [composing,setComposing]=useState(false)
  const [identitiesOpen,setIdentitiesOpen]=useState(false)
  const [securityOpen,setSecurityOpen]=useState(false)
  const [query,setQuery]=useState("")
  const [conversation,setConversation]=useState("*")
  const contacts=[...new Set(state.messages.flatMap(message=>message.recipient_email?[message.sender_email.toLowerCase()===state.email?message.recipient_email:message.sender_email]:[]))]
  const visibleMessages=state.messages.filter(message=>{
    const matchesConversation=conversation==="*"||(conversation==="broadcast"?!message.recipient_email:!!message.recipient_email&&(message.sender_email===conversation||message.recipient_email===conversation))
    const text=message.encrypted_payload?encryption.plaintext[message.id]??"":message.body
    return matchesConversation&&`${message.sender_email} ${message.recipient_email??"All employees"} ${message.deleted_at?"":text}`.toLowerCase().includes(query.toLowerCase())
  })
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const selected=state.messages.find(message=>message.id===selectedId)
  const [now,setNow] = useState(Date.now())
  const [readIds,setReadIds] = useState<Set<string>>(new Set())
  const operation=useRef(false)
  const missingRecipients=encryption.loaded&&encryption.unlocked
    ? audienceEmails(users,audience,recipient||null).filter(email=>!encryption.keys.some(key=>key.email.toLowerCase()===email.toLowerCase()))
    : []
  useEffect(() => {
    const timer = window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[])
  useEffect(() => {
    if(!canSend)return
    setRosterLoading(true)
    const controller=new AbortController()
    fetch(apiPath("/api/delegation"),{cache:"no-store",signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setUsers(data.users.filter((user:{accessStatus:string})=>user.accessStatus==="active"))})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message)})
      .finally(()=>{if(!controller.signal.aborted)setRosterLoading(false)})
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
    if(!canSend||rosterLoading||!encryption.unlocked||missingRecipients.length||!body.trim())return
    operation.current=true;setBusy(true);setError(null)
    try{
      const target=audience==="individual"?recipient:null
      const recipients=audienceEmails(users,audience,target)
      if(!recipients.length)throw new Error("Select an audience with active recipients.")
      const encrypted=await encryption.encrypt(body,target,[state.email,...recipients])
      if(await mutate("POST",{recipient:target,audience,encrypted})){setBody("");setComposing(false)}
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
    <div className="flex items-center justify-between gap-2 border-b pb-3"><h2 className="text-base font-semibold">Messages <span className="text-xs text-muted-foreground">{state.unread ? `${state.unread} unread` : ""}</span></h2><div className="flex gap-2"><Button size="icon-sm" variant="ghost" title="Message settings" aria-label="Message settings" onClick={()=>setSecurityOpen(true)}><Settings className="size-4"/></Button><Button size="icon-sm" variant="ghost" title="Refresh inbox" aria-label="Refresh inbox" onClick={state.refresh}><RefreshCw className="size-4"/></Button></div></div>
    {(error||state.error)&&<p role="alert" className="text-sm text-destructive">{error||state.error}</p>}
    {!encryption.unlocked&&<Button size="sm" variant="outline" onClick={()=>setSecurityOpen(true)}><LockKeyhole className="size-4"/>Unlock messages</Button>}
    {encryption.error&&<p role="alert" className="text-sm text-destructive">{encryption.error}</p>}
    {securityOpen&&<WindowSurface title="Message settings" onBack={()=>setSecurityOpen(false)} disabled={encryption.busy}><div className="w-full max-w-xl overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary"/>{encryption.unlocked?"Messaging encryption unlocked":"Messaging encryption locked"}</p>{encryption.unlocked&&<Button size="sm" variant="outline" onClick={encryption.lock}>Lock messages</Button>}</div>
      {encryption.error&&<p role="alert" className="mt-2 text-sm text-destructive">{encryption.error}</p>}
      {!encryption.unlocked&&encryption.loaded&&<form className="mt-3 grid max-w-lg gap-2" onSubmit={async event=>{event.preventDefault();if(!encryption.own&&passphrase!==confirmation){setError("Recovery passphrases must match.");return}if(await encryption.unlock(passphrase)){setPassphrase("");setConfirmation("");setSecurityOpen(false)}}}>
        <label className="text-sm">Recovery passphrase<input type="password" autoComplete="off" minLength={encryption.own?1:16} required value={passphrase} onChange={event=>setPassphrase(event.target.value)} className="mt-1 block w-full rounded-md border p-2"/></label>
        {!encryption.own&&<><label className="text-sm">Confirm recovery passphrase<input type="password" autoComplete="off" minLength={16} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="mt-1 block w-full rounded-md border p-2"/></label><p className="text-xs text-muted-foreground">Use at least 16 characters. Keep this separate from your Microsoft password. Losing it means losing access to encrypted messages.</p></>}
        <Button type="submit" className="w-fit" disabled={encryption.busy}>{encryption.busy?"Unlocking...":encryption.own?"Unlock messages":"Set up encryption"}</Button>
      </form>}
      {encryption.own&&<Button variant="ghost" size="sm" className="mt-2" onClick={()=>setIdentitiesOpen(true)}><LockKeyhole className="size-3"/>Encryption identities</Button>}
      {error&&<p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div></WindowSurface>}
    <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-0 flex-1"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground"/><input aria-label="Search messages" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search messages" className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"/></label><select aria-label="Conversation" value={conversation} onChange={event=>setConversation(event.target.value)} className="max-w-full rounded-md border bg-background p-2 text-sm"><option value="*">All conversations</option><option value="broadcast">Announcements</option>{contacts.map(email=><option key={email} value={email}>{email}</option>)}</select></div>
    {canSend&&<Button variant="outline" size="sm" onClick={()=>setComposing(true)}><Pencil className="size-3"/>New message</Button>}
    {composing&&<WindowSurface title="New message" onBack={()=>setComposing(false)} disabled={busy}><section className="flex min-h-0 w-full max-w-4xl flex-col bg-white"><h2 className="border-b p-4 font-semibold">New message</h2><div className="grid min-h-0 flex-1 content-start gap-3 overflow-auto p-4">
      {!encryption.unlocked&&<Button variant="outline" size="sm" onClick={()=>setSecurityOpen(true)}><LockKeyhole className="size-4"/>Unlock messages</Button>}
      {encryption.error&&<p role="alert" className="text-sm text-destructive">{encryption.error}</p>}
      {rosterLoading&&<p role="status" className="text-sm text-muted-foreground">Loading recipients...</p>}
      {missingRecipients.length>0&&<p role="status" className="text-sm text-muted-foreground">Messaging setup required for: {missingRecipients.join(", ")}. Choose a recipient who has completed setup, or ask these recipients to open Message settings.</p>}
      <label className="text-sm">Audience<select value={audience} disabled={busy} onChange={event=>{setAudience(event.target.value as MessageAudience);setRecipient("")}} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="workforce">Employees and contractors</option><option value="everyone">Everyone</option><option value="contractor">All contractors</option><option value="employee">All employees</option><option value="manager">All managers</option><option value="admin">All admins</option><option value="individual">Individual</option></select></label>
      {audience==="individual"&&<label className="text-sm">Recipient<select value={recipient} disabled={busy} onChange={event=>setRecipient(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="">Choose a person</option>{users.map(user=><option key={user.email} value={user.email}>{user.email}</option>)}</select></label>}
      <label className="text-sm">Message<textarea value={body} disabled={busy} maxLength={4000} onChange={event=>setBody(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border border-border bg-background p-2"/></label>
      <Button className="w-fit" disabled={busy||rosterLoading||!body.trim()||!encryption.unlocked||missingRecipients.length>0} onClick={send}><Send className="size-4"/>{busy?"Sending...":"Send message"}</Button>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    </div></section></WindowSurface>}
    {identitiesOpen&&<WindowSurface title="Encryption identities" onBack={()=>setIdentitiesOpen(false)}><section className="w-full overflow-auto bg-white p-4"><h2 className="font-semibold">Encryption identities</h2><p className="my-3 text-sm text-muted-foreground">Compare fingerprints with participants using another trusted channel.</p><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Actor</th><th className="p-2">Fingerprint</th></tr></thead><tbody>{encryption.keys.map(key=><tr key={key.email} className="border-b"><td className="p-2">{key.email}</td><td className="break-all p-2 font-mono text-xs">{key.fingerprint}</td></tr>)}</tbody></table></section></WindowSurface>}
    {state.loading&&<p role="status" className="text-sm text-muted-foreground">Loading messages...</p>}
    {!state.loading&&!state.messages.length&&<p className="text-sm text-muted-foreground">No messages yet.</p>}
    <div className="max-h-[60dvh] min-h-48 space-y-3 overflow-auto overscroll-contain bg-neutral-50 p-3 sm:p-4">{!state.loading&&state.messages.length>0&&!visibleMessages.length&&<p className="text-sm text-muted-foreground">No matching messages.</p>}{visibleMessages.map(message=>{
      const own=message.sender_email.toLowerCase()===state.email
      const text=message.encrypted_payload?encryption.plaintext[message.id]??"Encrypted message · unlock to read":message.body
      const editable=(canSend||state.admin)&&(!message.encrypted_payload||!!encryption.plaintext[message.id])&&canEditMessage(message,state.email,state.admin,now)
      return <article key={message.id} className={`w-fit max-w-[92%] rounded-md border p-3 shadow-sm sm:max-w-[75%] ${own?"ml-auto border-emerald-200 bg-emerald-50":"mr-auto border-border bg-white"}`}>
        <button type="button" className="block w-full cursor-pointer break-words text-left text-sm" onClick={()=>{setSelectedId(message.id);void read(message)}}><span className="font-medium">{message.sender_email} → {message.recipient_email ?? "All employees"}</span><time className="ml-2 text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time>
          {!own&&!message.read_at&&!readIds.has(message.id)&&!message.deleted_at&&<span className="ml-2 inline-block size-2 rounded-full bg-primary" aria-label="Unread message"/>}
          <span className="my-2 block whitespace-pre-wrap break-words">{message.deleted_at?"Message deleted":text}</span>
          {message.edited_at&&!message.deleted_at&&<span className="text-xs text-muted-foreground">Edited{message.encrypted_payload?.author!==message.sender_email&&message.encrypted_payload?.author?` by ${message.encrypted_payload.author}`:""} · </span>}
          {own&&!message.deleted_at&&<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{message.read_at||message.read_count ? <CheckCheck className="size-3 text-primary"/> : message.delivered_at||message.delivered_count ? <CheckCheck className="size-3"/> : <Check className="size-3"/>}{message.recipient_email ? message.read_at?"Read":message.delivered_at?"Delivered":"Sent" : `Sent · Delivered to ${message.delivered_count??0} · Read by ${message.read_count??0}`}</span>}
        </button>
        {selected?.id===message.id&&<WindowSurface title="Message detail" onBack={()=>setSelectedId(null)}><section className="flex min-h-0 w-full max-w-4xl flex-col bg-white"><header className="border-b p-4"><h2 className="font-semibold">Message detail</h2><p className="text-sm text-muted-foreground">{message.sender_email} → {message.recipient_email??"All employees"}</p></header><div className="min-h-0 flex-1 overflow-auto p-4"><p className="whitespace-pre-wrap break-words text-sm">{message.deleted_at?"Message deleted":text}</p>
        {!message.deleted_at&&<div className="mt-4 flex flex-wrap gap-2">
          {editable&&<Button variant="outline" size="sm" onClick={()=>{setEditing(message);setDraft(text)}}><Pencil className="size-3"/>Edit message</Button>}
          {(state.admin||(own&&canSend))&&<Button variant="outline" size="sm" onClick={()=>setDeleting(message)}><Trash2 className="size-3"/>Delete message</Button>}
          {own&&!state.admin&&!editable&&<p className="text-xs text-muted-foreground">Editing closed after {MESSAGE_EDIT_MINUTES} minutes.</p>}
        </div>}
        </div></section></WindowSurface>}
      </article>
    })}</div>
    {editing&&<WindowSurface title="Edit message" onBack={()=>setEditing(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-3xl flex-col bg-white">
      <h2 className="border-b p-4 font-semibold">Edit message</h2><div className="min-h-0 flex-1 overflow-auto p-4"><label className="text-sm">Message<textarea className="mt-2 min-h-40 w-full rounded-md border p-3" value={draft} maxLength={4000} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      <div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setEditing(null)}><X className="size-4"/>Cancel</Button><Button disabled={busy||!draft.trim()||!canEditMessage(editing,state.email,state.admin,now)} onClick={saveEdit}><Save className="size-4"/>{busy?"Saving...":"Save message"}</Button></div>
    </section></WindowSurface>}
    {deleting&&<WindowSurface title="Delete message" onBack={()=>setDeleting(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-xl flex-col bg-white"><h2 className="border-b p-4 font-semibold">Delete message</h2><div className="min-h-0 flex-1 overflow-auto p-4"><p className="text-sm">Delete this message for everyone? Its content will be replaced with a deletion marker.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div><div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async()=>{if(await mutate("DELETE",{id:deleting.id}))setDeleting(null)}}><Trash2 className="size-4"/>{busy?"Deleting...":"Delete for everyone"}</Button></div></section></WindowSurface>}
  </section>
}
