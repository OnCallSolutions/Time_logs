/**
 * Provides manager-to-employee messaging and delegated workflow-rights editing.
 * Inboxes refresh periodically; role and capability changes come from the parent.
 * Rights are staged with Edit and committed only when the user explicitly saves.
 */
"use client"
import { useEffect,useState } from "react"
import { Pencil, RefreshCw, Save, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import { notifyPermissionsChanged } from "@/lib/permission-events"
import { permissionLabels, type Permission, type Permissions } from "@/lib/permissions"
type Employee = {email:string;permissions:Permissions}
type Message = {id:string;sender_email:string;recipient_email:string|null;body:string;created_at:string}

/**
 * Loads eligible employee identities for authorized sender/delegator controls.
 * @param enabled - Whether current rights permit employee-directory discovery.
 * @returns Object containing employee roster and any load failure.
 */
function useRoster(enabled:boolean) {
  const [users,setUsers] = useState<Employee[]>([])
  const [error,setError] = useState<string|null>(null)
  useEffect(()=>{
    if(!enabled) {setUsers([]);return}
    const controller = new AbortController()
    fetch(apiPath("/api/delegation"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data = await response.json(); if(!response.ok) throw new Error(data.error); setUsers(data.users)
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[enabled])
  return {users,error}
}

/**
 * Displays the authorized inbox and optional manager message-composition controls.
 * @param props.canSend - Whether current server rights enable composition.
 * @returns JSX.Element containing private/broadcast messages and delivery controls.
 */
export function MessagesPanel({canSend}:{canSend:boolean}) {
  const {users,error:rosterError} = useRoster(canSend)
  const [messages,setMessages] = useState<Message[]>([])
  const [recipient,setRecipient] = useState("")
  const [body,setBody] = useState("")
  const [error,setError] = useState<string|null>(null)
  const [sending,setSending] = useState(false)
  const [refresh,setRefresh] = useState(0)
  useEffect(()=>{
    const controller = new AbortController()
    /**
     * Refreshes only messages authorized for the current authenticated account.
     * @returns Promise<void> once the inbox or error has been updated.
     */
    async function load():Promise<void> {
      try {const response = await fetch(apiPath("/api/messages"),{cache:"no-store",signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);setMessages(data.messages);setError(null)}
      catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Inbox unavailable.")}
    }
    void load();const timer=window.setInterval(load,15000);window.addEventListener("focus",load)
    return ()=>{controller.abort();window.clearInterval(timer);window.removeEventListener("focus",load)}
  },[refresh])
  /**
   * Saves the composed message after an explicit Send click.
   * @returns Promise<void> after delivery status and the inbox are refreshed.
   */
  async function send():Promise<void> {
    setSending(true);setError(null)
    try {const response=await fetch(apiPath("/api/messages"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipient:recipient||null,body})});const data=await response.json();if(!response.ok)throw new Error(data.error);setBody("");setRefresh(value=>value+1)}
    catch(error){setError(error instanceof Error?error.message:"Unable to send.")}
    finally{setSending(false)}
  }
  return <section aria-label="Messages" className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Messages</h2><Button size="icon-sm" variant="outline" title="Refresh inbox" aria-label="Refresh inbox" onClick={()=>setRefresh(value=>value+1)}><RefreshCw className="size-4"/></Button></div>
    {(error||rosterError)&&<p role="alert" className="text-sm text-destructive">{error||rosterError}</p>}
    {canSend&&<div className="grid gap-3 border-y border-border py-4">
      <label className="text-sm">Recipient<select value={recipient} disabled={sending} onChange={event=>setRecipient(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="">All employees</option>{users.map(user=><option key={user.email} value={user.email}>{user.email}</option>)}</select></label>
      <label className="text-sm">Message<textarea value={body} disabled={sending} maxLength={4000} onChange={event=>setBody(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border border-border bg-background p-2"/></label>
      <Button className="w-fit" disabled={sending||!body.trim()} onClick={send}><Send className="size-4"/>{sending?"Sending...":"Send message"}</Button>
    </div>}
    {!messages.length&&<p className="text-sm text-muted-foreground">No messages yet.</p>}
    <div className="max-h-[60dvh] overflow-auto overscroll-contain">{messages.map(message=><article key={message.id} className="border-b border-border py-4">
      <p className="break-words text-sm font-medium">{message.sender_email} → {message.recipient_email ?? "All employees"}</p><time className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.body}</p>
    </article>)}</div>
  </section>
}

/**
 * Lets managers stage workflow-rights changes for employees within held authority.
 * @param props.permissions - Authenticated delegator's current effective rights.
 * @returns JSX.Element containing employee selection and explicit Edit/Save controls.
 */
export function EmployeeRightsPanel({permissions}:{permissions:Permissions}) {
  const {users,error:rosterError}=useRoster(permissions.delegate_permissions)
  const [email,setEmail]=useState("")
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<Partial<Permissions>>({})
  const [error,setError]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const [savedRights,setSavedRights]=useState<Record<string,Permissions>>({})
  const selected=users.map(user=>savedRights[user.email]?{...user,permissions:savedRights[user.email]}:user).find(user=>user.email===email)
  /**
   * Saves only changed rights; the API independently validates delegation limits.
   * @returns Promise<void> after explicit rights changes are saved or rejected.
   */
  async function save():Promise<void> {
    if(!selected)return;setSaving(true);setError(null)
    const changed=Object.fromEntries(Object.entries(draft).filter(([key,value])=>selected.permissions[key as Permission]!==value))
    try{const response=await fetch(apiPath("/api/delegation"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,permissions:changed})});const data=await response.json();if(!response.ok)throw new Error(data.error);setSavedRights(previous=>({...previous,[email]:{...selected.permissions,...draft}}));setEditing(false);notifyPermissionsChanged()}
    catch(error){setError(error instanceof Error?error.message:"Unable to save rights.")}
    finally{setSaving(false)}
  }
  return <section aria-label="Employee rights" className="space-y-4">
    <h2 className="text-base font-semibold">Employee rights</h2>
    {(error||rosterError)&&<p role="alert" className="text-sm text-destructive">{error||rosterError}</p>}
    <label className="block text-sm">Employee<select value={email} disabled={editing} onChange={event=>setEmail(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="">Select employee</option>{users.map(user=><option key={user.email} value={user.email}>{user.email}</option>)}</select></label>
    <Button variant="outline" disabled={!selected||editing} onClick={()=>{setDraft({...selected!.permissions});setEditing(true)}}><Pencil className="size-4"/>Edit rights</Button>
    {selected&&<fieldset className="grid gap-3">{(Object.entries(permissionLabels) as [Permission,string][]).filter(([key])=>key!=="delegate_permissions"&&key!=="send_messages").map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing?!!draft[key]:selected.permissions[key]} disabled={!editing||saving||(!permissions[key]&&!draft[key])} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/>{label}</label>)}</fieldset>}
    {editing&&<div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={saving} onClick={save}><Save className="size-4"/>{saving?"Saving...":"Save rights"}</Button></div>}
  </section>
}
