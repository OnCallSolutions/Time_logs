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
import { apiPath } from "@/lib/paths"
import { notifyPermissionsChanged } from "@/lib/permission-events"
import { permissionLabels, type Permission, type Permissions } from "@/lib/permissions"
type Employee = {email:string;permissions:Permissions}

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
    {selected&&!editing&&<details className="border-y border-border py-2"><summary className="cursor-pointer text-sm font-medium">Current rights</summary><ul className="grid gap-1 pt-2 text-sm">{(Object.entries(permissionLabels) as [Permission,string][]).filter(([key])=>selected.permissions[key]).map(([key,label])=><li key={key}>{label}</li>)}</ul></details>}
    {selected&&editing&&<fieldset className="grid gap-3 sm:grid-cols-2">{(Object.entries(permissionLabels) as [Permission,string][]).filter(([key])=>key!=="delegate_permissions"&&key!=="send_messages").map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft[key]} disabled={saving||(!permissions[key]&&!draft[key])} onChange={event=>setDraft({...draft,[key]:event.target.checked})}/>{label}</label>)}</fieldset>}
    {editing&&<div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={saving} onClick={save}><Save className="size-4"/>{saving?"Saving...":"Save rights"}</Button></div>}
  </section>
}
