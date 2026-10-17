/**
 * Provides explicit manager/admin onboarding with approved official identities.
 * The server generates the immutable contractor number and controls duplicate checks.
 * Existing identity corrections are a separate administrator-confirmed operation.
 */
"use client"
import { useEffect, useState } from "react"
import { UserPlus, Save, AlertTriangle } from "lucide-react"
import { Button } from "./ui/button"
import { WindowSurface } from "./window-surface"
import { apiPath } from "@/lib/paths"
import { normalizeEmail, normalizeOfficialName } from "@/lib/identity-policy"
import { notifyPermissionsChanged } from "@/lib/permission-events"

/**
 * Captures official details and waits for confirmed account creation.
 * @param props.admin - Whether an existing account's official identity may be corrected.
 * @returns JSX.Element containing the compact command and confirmation window.
 */
export function AddPerson({ admin = false }: { admin?: boolean }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [email, setEmail] = useState("")
  const [role, setRole] = useState("contractor"), [correctExisting, setCorrectExisting] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [companyDomains,setCompanyDomains]=useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [number, setNumber] = useState("")
  const emailDomain=normalizeEmail(email).split("@")[1]??""
  const emailDomainWarning=companyDomains.length>0&&emailDomain&&!companyDomains.includes(emailDomain)
    ? emailDomain==="gmail.com"
      ? "This is a personal Gmail address, which is allowed. Verify the person's identity before saving."
      : `${emailDomain} is outside this organization's configured email domains. Review the address before saving; personal email addresses remain allowed.`
    : ""
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController()
    fetch(apiPath("/api/people"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)return
      const data=await response.json() as {companyEmailDomains?:string[]}
      if(!controller.signal.aborted)setCompanyDomains(data.companyEmailDomains??[])
    }).catch(()=>undefined)
    return ()=>controller.abort()
  },[open])
  /**
   * Saves normalized official details without accepting a caller-issued identifier.
   * @param event - Form submission from the explicit save button.
   * @returns Promise<void> after success or an error preserving the draft.
   */
  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault(); if (busy) return
    setBusy(true); setError("")
    try {
      const response = await fetch(apiPath("/api/people"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), officialName: normalizeOfficialName(name), employeeId, role, correctExisting }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setNumber(data.identity.shortReference || data.identity.contractorNumber); notifyPermissionsChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add this person.") }
    finally { setBusy(false) }
  }
  return <><Button variant="outline" size="sm" onClick={() => { setOpen(true); setNumber(""); setError("") }}><UserPlus className="size-4"/>Add contractor/employee</Button>
    {open && <WindowSurface title="Official company identity" disabled={busy} onBack={() => setOpen(false)}><form onSubmit={save} className="flex min-h-0 w-full flex-col bg-white">
      <header className="border-b p-4"><h2 className="font-semibold">{correctExisting ? "Correct official identity" : "Add contractor/employee"}</h2></header>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-auto p-4 sm:grid-cols-2">
        <label className="text-sm">Official name<input required minLength={2} maxLength={80} disabled={busy || !!number} value={name} onChange={event => setName(event.target.value)} onBlur={() => setName(normalizeOfficialName(name))} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Company account email<input type="email" required maxLength={254} disabled={busy || !!number} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => setEmail(normalizeEmail(email))} className="mt-1 block w-full rounded border p-2"/>{emailDomainWarning&&<span role="status" className="mt-1 flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0"/>{emailDomainWarning}</span>}</label>
        <label className="text-sm">Category<select disabled={busy || !!number} value={role} onChange={event => setRole(event.target.value)} className="mt-1 block w-full rounded border p-2"><option value="contractor">Contractor</option><option value="employee">Employee</option></select></label>
        <label className="text-sm">Company employee ID (optional)<input maxLength={64} disabled={busy || !!number} value={employeeId} onChange={event => setEmployeeId(event.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
        {admin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={correctExisting} disabled={busy || !!number} onChange={event => setCorrectExisting(event.target.checked)}/>Correct an existing account's official name</label>}
        {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
        {number && <p role="status" className="break-all text-sm text-green-800 sm:col-span-2">Saved. Company reference: {number}. The permanent account ID remains stored separately.</p>}
      </div><footer className="flex justify-end gap-2 border-t p-4"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{number ? "Close" : "Cancel"}</Button>{!number && <Button type="submit" disabled={busy}><Save className="size-4"/>{busy ? "Saving..." : "Save official identity"}</Button>}</footer>
    </form></WindowSurface>}
  </>
}
