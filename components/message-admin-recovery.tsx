/**
 * Gives administrators an explicit, audited recovery action for enrolled devices.
 * No private keys, recovery phrases or decrypted messages appear in this window.
 * Recovery runs one bounded history page per confirmation with truthful counts.
 */
"use client"
import { useState } from "react"
import { ShieldCheck } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"

/** @returns JSX.Element with admin-only recovery selection and explicit confirmation. */
export function MessageAdminRecovery() {
  const [open,setOpen]=useState(false),[email,setEmail]=useState(""),[target,setTarget]=useState("")
  const [devices,setDevices]=useState<{deviceId:string;fingerprint:string}[]>([])
  const [configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState("")
  const [before,setBefore]=useState<{date:string;id:string}|null>(null)
  /** @returns Promise<void> after loading enrolled target devices without using recovery keys. */
  async function inspect():Promise<void>{
    setBusy(true);setError("");setResult("");setBefore(null);setTarget("");setDevices([])
    try{
      const response=await fetch(`${apiPath("/api/messages/recovery")}?email=${encodeURIComponent(email)}`,{cache:"no-store"})
      const data=await response.json();if(!response.ok)throw new Error(data.error)
      setDevices(data.devices);setConfigured(data.configured)
    }catch(cause){setError(cause instanceof Error?cause.message:"Recovery unavailable.")}
    finally{setBusy(false)}
  }
  /** @returns Promise<void> after explicitly recovering at most fifty messages and recording audit events. */
  async function recover():Promise<void>{
    setBusy(true);setError("")
    try{
      const response=await fetch(apiPath("/api/messages/recovery"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,target,before})})
      const data=await response.json();if(!response.ok)throw new Error(data.error)
      setResult(`${data.restored} messages restored; ${data.unavailable} have no recovery envelope.${data.next?" More history remains.":" History scan complete."}`);setBefore(data.next)
    }catch(cause){setError(cause instanceof Error?cause.message:"Recovery not confirmed.")}
    finally{setBusy(false)}
  }
  return <><Button variant="outline" size="sm" onClick={()=>setOpen(true)}><ShieldCheck className="size-4"/>Organization history recovery</Button>{open&&<WindowSurface title="Organization history recovery" disabled={busy} onBack={()=>setOpen(false)}><section className="flex min-h-0 w-full flex-col bg-white"><h2 className="border-b p-4 font-semibold">Administrator-assisted history recovery</h2><div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
    <label className="block text-sm">Account email<input type="email" value={email} disabled={busy} onChange={event=>{setEmail(event.target.value);setDevices([]);setConfigured(false);setBefore(null);setResult("")}} className="mt-1 block w-full max-w-lg rounded border p-2"/></label><Button variant="outline" disabled={busy||!email} onClick={inspect}>Check registered devices</Button>
    {!configured&&devices.length>0&&<p className="text-sm">Organization recovery is not configured. A trusted device can still synchronize history.</p>}
    {devices.length>0&&<label className="block text-sm">Receiving device<select value={target} disabled={busy} onChange={event=>{setTarget(event.target.value);setBefore(null);setResult("")}} className="mt-1 block w-full max-w-lg rounded border p-2"><option value="">Select an enrolled device</option>{devices.map(device=><option key={device.deviceId} value={device.fingerprint}>{device.deviceId}</option>)}</select></label>}
    <p className="text-sm text-muted-foreground">This action uses organization-held recovery keys and is audited. It restores only messages with an existing recovery envelope, never unencrypted message content.</p>
    {result&&<p role="status" className="text-sm text-green-800">{result}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    </div><footer className="flex justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Close</Button><Button disabled={busy||!configured||!target} onClick={recover}>{busy?"Recovering...":before?"Recover next history page":"Confirm history recovery"}</Button></footer></section></WindowSurface>}</>
}
