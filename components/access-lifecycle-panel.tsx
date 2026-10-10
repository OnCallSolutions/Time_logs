/**
 * Presents explicit offboarding schedules and temporary coverage assignments.
 * Local datetime controls are serialized to UTC; every consequential action
 * requires a reason and confirmation in an isolated window.
 */
"use client"
import { useEffect,useState } from "react"
import { CalendarClock,KeyRound,Pause,Play,RefreshCw,X,CalendarPlus,Ban } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import { permissionLabels,type Permissions } from "@/lib/permissions"
import { temporaryPermissions,type AccountLifecycle,type TemporaryAssignment,type TemporaryPermission } from "@/lib/access-lifecycle-policy"
type Action="schedule_cutoff"|"cancel_cutoff"|"suspend"|"reactivate"|"grant"|"extend"|"revoke"
const titles:Record<Action,string>={schedule_cutoff:"Schedule deactivation",cancel_cutoff:"Cancel deactivation",suspend:"Suspend access",reactivate:"Reactivate lifecycle access",grant:"Temporary assignment",extend:"Extend assignment",revoke:"Revoke assignment"}

/** @param date - Absolute time. @returns Local datetime input value without changing the saved instant. */
function localInput(date:Date):string{return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
/** @param value - Persisted UTC/offset timestamp. @returns Display time in the current browser locale. */
function displayTime(value:string|null):string{return value?new Date(value).toLocaleString():"Not scheduled"}

/**
 * Renders admin lifecycle actions or a manager's authorized operational coverage.
 * @param props.admin - Whether the verified shell role is administrator.
 * @param props.permissions - Current live rights; the API independently rechecks.
 * @returns JSX.Element with compact schedule/grant tables and explicit editing.
 */
export function AccessLifecyclePanel({admin,permissions}:{admin:boolean;permissions:Permissions}){
  const [actors,setActors]=useState<{email:string;role:string;accessStatus:string}[]>([])
  const [schedules,setSchedules]=useState<AccountLifecycle[]>([])
  const [assignments,setAssignments]=useState<TemporaryAssignment[]>([])
  const [actor,setActor]=useState("")
  const [editor,setEditor]=useState<{action:Action;id?:string;email:string}|null>(null)
  const [start,setStart]=useState(""),[end,setEnd]=useState(""),[reason,setReason]=useState("")
  const [scope,setScope]=useState<"own"|"all">("own")
  const [rights,setRights]=useState<TemporaryPermission[]>(["submit_entries"])
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[revision,setRevision]=useState(0)
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>window.clearInterval(timer)},[])
  useEffect(()=>{
    const controller=new AbortController();setError("")
    /** @returns Promise<void> after loading authorized lifecycle records and actor choices. */
    async function load(){
      try{
        const response=await fetch(apiPath("/api/access-lifecycle"),{cache:"no-store",signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error)
        const roster=await fetch(apiPath(admin?"/api/users":"/api/delegation"),{cache:"no-store",signal:controller.signal});const people=await roster.json();if(!roster.ok)throw new Error(people.error)
        if(!controller.signal.aborted){setSchedules(data.schedules);setAssignments(data.assignments);setActors(people.users.filter((user:{role:string})=>user.role!=="admin"&&user.role!=="none"&&(admin||user.role==="employee"||user.role==="contractor")))}
      }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Lifecycle unavailable.")}
    }
    void load();return()=>controller.abort()
  },[admin,revision])
  /** @param action - Explicit operation. @param grant - Existing assignment for extension/revocation. @returns void after opening a fresh confirmation draft. */
  function open(action:Action,grant?:TemporaryAssignment){
    setError("");setReason("");setStart(localInput(new Date()));setEnd(grant?localInput(new Date(grant.endsAt)):"");setScope("own");setRights(["submit_entries"])
    setEditor({action,id:grant?.id,email:grant?.email??actor})
  }
  /** @returns Promise<void> after explicit server-confirmed action and list refresh. */
  async function save(){
    if(!editor||busy)return
    setBusy(true);setError("")
    try{
      const payload:Record<string,unknown>={action:editor.action,reason}
      if(editor.id)payload.id=editor.id;else payload.email=editor.email
      if(editor.action==="schedule_cutoff")payload.cutoffAt=new Date(end).toISOString()
      if(editor.action==="suspend")payload.reviewAt=new Date(end).toISOString()
      if(editor.action==="grant"){payload.startsAt=new Date(start).toISOString();payload.endsAt=new Date(end).toISOString();payload.scope=scope;payload.permissions=rights}
      if(editor.action==="extend")payload.endsAt=new Date(end).toISOString()
      const response=await fetch(apiPath("/api/access-lifecycle"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error)
      setEditor(null);setRevision(value=>value+1)
    }catch(error){setError(error instanceof Error?error.message:"Lifecycle action failed.")}finally{setBusy(false)}
  }
  const active=assignments.filter(grant=>!grant.revokedAt&&Date.parse(grant.startsAt)<=now&&now<Date.parse(grant.endsAt)).length
  return <section aria-label="Access lifecycle" className="space-y-4 bg-white p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{admin?"Access lifecycle":"Temporary coverage"}</h2><Button variant="outline" size="icon-sm" title="Refresh lifecycle" aria-label="Refresh lifecycle" onClick={()=>setRevision(value=>value+1)}><RefreshCw className="size-4"/></Button></header>
    <div className="flex flex-wrap gap-5 text-sm"><p>{schedules.filter(row=>row.cutoffAt&&Date.parse(row.cutoffAt)>now).length} upcoming cutoffs</p><p>{schedules.filter(row=>row.suspended).length} suspended</p><p>{active} active assignments</p></div>
    {!editor&&error&&<p role="alert" className="text-destructive">{error}</p>}
    <label className="block text-sm">Account<select className="mt-1 block w-full max-w-xl rounded-md border bg-white p-2" value={actor} onChange={event=>setActor(event.target.value)}><option value="">Choose account</option>{actors.map(user=><option key={user.email} value={user.email}>{user.email} ({user.role.replaceAll("_"," ")}, {user.accessStatus})</option>)}</select></label>
    <div className="flex flex-wrap gap-2">
      {admin&&<><Button variant="outline" disabled={!actor} onClick={()=>open("schedule_cutoff")}><CalendarClock className="size-4"/>Schedule deactivation</Button><Button variant="outline" disabled={!actor} onClick={()=>open("cancel_cutoff")}><X className="size-4"/>Cancel deactivation</Button><Button variant="outline" disabled={!actor} onClick={()=>open("suspend")}><Pause className="size-4"/>Suspend</Button><Button variant="outline" disabled={!actor} onClick={()=>open("reactivate")}><Play className="size-4"/>Reactivate</Button></>}
      <Button disabled={!actor||actors.find(user=>user.email===actor)?.role==="account_manager"} onClick={()=>open("grant")}><KeyRound className="size-4"/>Temporary assignment</Button>
    </div>
    {admin&&<div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-orange-50"><tr><th className="p-2">Account</th><th className="p-2">Cutoff</th><th className="p-2">State</th><th className="p-2">Review date</th></tr></thead><tbody>{schedules.map(row=><tr key={row.email} className="border-t"><td className="p-2">{row.email}</td><td className="p-2">{displayTime(row.cutoffAt)}</td><td className="p-2">{row.suspended?"Suspended":row.cutoffAt&&Date.parse(row.cutoffAt)<=now?"Cutoff effective":"Scheduled / active"}</td><td className="p-2">{displayTime(row.reviewAt)}</td></tr>)}</tbody></table></div>}
    <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-orange-50"><tr><th className="p-2">Account</th><th className="p-2">Scope / duties</th><th className="p-2">Expiry</th><th className="p-2">State</th><th className="p-2">Actions</th></tr></thead><tbody>{assignments.map(grant=><tr key={grant.id} className="border-t"><td className="p-2">{grant.email}</td><td className="p-2">{grant.scope==="all"?"Whole application":"Own records"}<p>{grant.permissions.map(key=>permissionLabels[key]).join(", ")}</p></td><td className="p-2">{displayTime(grant.endsAt)}</td><td className="p-2">{grant.revokedAt?"Revoked":now>=Date.parse(grant.endsAt)?"Expired":now<Date.parse(grant.startsAt)?"Scheduled":"Within assignment window"}</td><td className="p-2"><div className="flex gap-2"><Button variant="ghost" size="icon-sm" disabled={!!grant.revokedAt} title="Extend assignment" aria-label={`Extend assignment for ${grant.email}`} onClick={()=>open("extend",grant)}><CalendarPlus className="size-4"/></Button><Button variant="ghost" size="icon-sm" disabled={!!grant.revokedAt} title="Revoke assignment" aria-label={`Revoke assignment for ${grant.email}`} onClick={()=>open("revoke",grant)}><Ban className="size-4"/></Button></div></td></tr>)}</tbody></table></div>
    {editor&&<WindowSurface title={titles[editor.action]} disabled={busy} onBack={()=>setEditor(null)}><form className="flex min-h-0 w-full flex-col bg-white" onSubmit={event=>{event.preventDefault();void save()}}><header className="border-b p-4"><h2 className="font-semibold">{titles[editor.action]}</h2><p className="text-sm">{editor.email}</p></header><div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {editor.action==="grant"&&<><label className="block text-sm">Scope<select value={scope} onChange={event=>{setScope(event.target.value as "own"|"all");setRights(["submit_entries"])}} className="ml-2 rounded-md border p-2"><option value="own">Own records</option><option value="all">Whole application</option></select></label><fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm">Operational duties</legend>{temporaryPermissions.filter(key=>scope==="all"||["create_entries","edit_entries","delete_entries","submit_entries"].includes(key)).map(key=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!admin&&!permissions[key]} checked={rights.includes(key)} onChange={event=>setRights(previous=>event.target.checked?[...previous,key]:previous.filter(value=>value!==key))}/>{permissionLabels[key]}</label>)}</fieldset><label className="block text-sm">Start (local time)<input type="datetime-local" required value={start} onChange={event=>setStart(event.target.value)} className="ml-2 rounded-md border p-2"/></label></>}
      {["schedule_cutoff","suspend","grant","extend"].includes(editor.action)&&<label className="block text-sm">{editor.action==="suspend"?"Review date (local time)":editor.action==="schedule_cutoff"?"Access cutoff (local time)":"Expiry (local time)"}<input type="datetime-local" required value={end} onChange={event=>setEnd(event.target.value)} className="ml-2 rounded-md border p-2"/></label>}
      <label className="block text-sm">Reason<textarea required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border p-2"/></label>
      {error&&<p role="alert" className="text-destructive">{error}</p>}
    </div><footer className="flex justify-end gap-2 border-t p-4"><Button type="button" variant="outline" disabled={busy} onClick={()=>setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy||!reason.trim()||(editor.action==="grant"&&!rights.length)}>{busy?"Saving...":"Confirm and save"}</Button></footer></form></WindowSurface>}
  </section>
}
