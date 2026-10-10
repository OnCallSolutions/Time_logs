/**
 * Provides manager-to-employee messaging and delegated workflow-rights editing.
 * Inboxes refresh periodically; role and capability changes come from the parent.
 * Rights are staged with Edit and committed only when the user explicitly saves.
 */
"use client"
import { useEffect,useState } from "react"
import { Pencil, Save } from "lucide-react"
export { MessagesPanel } from "@/components/messages-panel"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import { notifyPermissionsChanged } from "@/lib/permission-events"
import { permissionLabels, type Permission, type Permissions } from "@/lib/permissions"
type Employee = {email:string;displayName?:string;role:string;accessStatus:string;permissions:Permissions}

/**
 * Loads all actor identities for authorized delegators without widening edits.
 * @param enabled - Whether current rights permit employee-directory discovery.
 * @returns Object containing employee roster and any load failure.
 */
function useRoster(enabled:boolean) {
  const [users,setUsers] = useState<Employee[]>([])
  const [error,setError] = useState<string|null>(null)
  useEffect(()=>{
    if(!enabled) {setUsers([]);return}
    const controller = new AbortController()
    /**
     * Refreshes actor membership and rights without resetting an open editor draft.
     * @returns Promise<void> after the authorized roster or error is updated.
     */
    async function load():Promise<void>{
      try{const response=await fetch(apiPath("/api/delegation"),{cache:"no-store",signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);if(!controller.signal.aborted){setUsers(data.users);setError(null)}}
      catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Actor directory unavailable.")}
    }
    void load();const timer=window.setInterval(load,15000);window.addEventListener("focus",load);window.addEventListener("permissions-changed",load)
    const channel=typeof BroadcastChannel!=="undefined"?new BroadcastChannel("permissions-changed"):null
    if(channel)channel.onmessage=()=>void load()
    return ()=>{controller.abort();window.clearInterval(timer);window.removeEventListener("focus",load);window.removeEventListener("permissions-changed",load);channel?.close()}
  },[enabled])
  /**
   * Applies a confirmed save until the next authoritative server refresh arrives.
   * @param email - Actor identity receiving workflow changes.
   * @param permissions - Effective rights after merging only changed controls.
   * @returns void after updating the local actor row.
   */
  function updateRights(email:string,permissions:Permissions):void{setUsers(previous=>previous.map(user=>user.email===email?{...user,permissions}:user))}
  return {users,error,updateRights}
}

/**
 * Lets managers stage workflow-rights changes for employees within held authority.
 * @param props.permissions - Authenticated delegator's current effective rights.
 * @returns JSX.Element containing employee selection and explicit Edit/Save controls.
 */
export function EmployeeRightsPanel({permissions}:{permissions:Permissions}) {
  const {users,error:rosterError,updateRights}=useRoster(permissions.delegate_permissions)
  const [email,setEmail]=useState("")
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<Partial<Permissions>>({})
  const [baseline,setBaseline]=useState<Partial<Permissions>>({})
  const [error,setError]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const selected=users.find(user=>user.email===email)
  /**
   * Saves only changed rights; the API independently validates delegation limits.
   * @returns Promise<void> after explicit rights changes are saved or rejected.
   */
  async function save():Promise<void> {
    if(!selected)return;setSaving(true);setError(null)
    const changed=Object.fromEntries(Object.entries(draft).filter(([key,value])=>baseline[key as Permission]!==value))
    try{const response=await fetch(apiPath("/api/delegation"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,permissions:changed})});const data=await response.json();if(!response.ok)throw new Error(data.error);updateRights(email,{...selected.permissions,...changed});setEditing(false);notifyPermissionsChanged()}
    catch(error){setError(error instanceof Error?error.message:"Unable to save rights.")}
    finally{setSaving(false)}
  }
  return <section aria-label="Employee rights" className="space-y-4">
    <h2 className="text-base font-semibold">Employee rights</h2>
    {(error||rosterError)&&<p role="alert" className="text-sm text-destructive">{error||rosterError}</p>}
<div className="max-h-[60dvh] overflow-auto overscroll-contain"><table className="w-full min-w-[600px] text-left text-sm"><thead className="sticky top-0 bg-white"><tr className="border-b"><th className="p-2">Actor</th><th className="p-2">Role</th><th className="p-2">Access</th><th className="p-2">Rights</th><th className="p-2 text-right">Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.email} className="border-b"><td className="p-2"><p>{user.displayName||user.email}</p>{user.displayName&&<p className="text-xs text-muted-foreground">{user.email}</p>}</td><td className="p-2 capitalize">{user.role}</td><td className="p-2 capitalize">{user.accessStatus}</td><td className="p-2">{Object.values(user.permissions).filter(Boolean).length} allowed</td><td className="p-2 text-right">{(user.role==="employee"||user.role==="contractor")&&user.accessStatus==="active"?<Button variant="outline" size="sm" aria-label={`Edit rights for ${user.email}`} onClick={()=>{setEmail(user.email);setDraft({...user.permissions});setBaseline({...user.permissions});setError(null);setEditing(true)}}><Pencil className="size-3"/>Edit rights</Button>:<span className="text-xs text-muted-foreground">Admin managed</span>}</td></tr>)}</tbody></table></div>
    {selected&&editing&&<WindowSurface title="Edit employee rights" onBack={()=>setEditing(false)} disabled={saving}><section className="flex min-h-0 w-full max-w-4xl flex-col bg-white"><header className="border-b p-4"><h2 className="font-semibold">Edit employee rights</h2><p className="text-sm text-muted-foreground">{selected.email}</p></header><div className="min-h-0 flex-1 overflow-auto p-4">{error&&<p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}<fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(Object.entries(permissionLabels) as [Permission,string][]).filter(([key])=>key!=="delegate_permissions"&&key!=="send_messages"&&key!=="send_to_accounts"&&key!=="view_accounts"&&key!=="review_accounts"&&key!=="ai_accounts"&&key!=="review_manager_entries").map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft[key]} disabled={saving||(!permissions[key]&&!draft[key])} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/>{label}</label>)}</fieldset></div><footer className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={saving} onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={saving} onClick={save}><Save className="size-4"/>{saving?"Saving...":"Save rights"}</Button></footer></section></WindowSurface>}
  </section>
}
