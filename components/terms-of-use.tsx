"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, LoaderCircle, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import { CURRENT_TERMS_VERSION } from "@/lib/terms-constants"

export function TermsOfUseContent(){
  return <div className="space-y-5 text-sm leading-6 text-slate-700">
    <section><h2 className="font-semibold text-slate-950">1. Authorized use</h2><p>Use Tanovo Time only through your approved organization account and only for work you are authorized to perform. Do not share credentials, impersonate another patron, bypass access controls, probe accounts, or access another organization’s records without explicit authorization.</p></section>
    <section><h2 className="font-semibold text-slate-950">2. Information handling</h2><p>Enter, view, export, or send work and personal information only for an authorized business purpose and only to approved recipients. Use the minimum information needed. Do not upload or enter passwords, payment-card data, government identity numbers, health information, or other highly sensitive information unless your organization has expressly approved that use and configured suitable safeguards.</p></section>
    <section><h2 className="font-semibold text-slate-950">3. Security responsibilities</h2><p>Keep your Microsoft account and devices secure, use the organization’s required authentication controls, promptly sign out of shared devices, and report suspected account compromise or data exposure to your organization’s technology or privacy contact. Do not disable, evade, or interfere with security controls.</p></section>
    <section><h2 className="font-semibold text-slate-950">4. Prohibited activity</h2><p>You must not introduce malware or ransomware; attempt cross-site scripting, injection, credential theft, or unauthorized access; conduct denial-of-service or distributed denial-of-service activity; scrape or bulk-export data without approval; or disrupt, damage, reverse-engineer, or test the service without written authorization.</p></section>
    <section><h2 className="font-semibold text-slate-950">5. Accurate records and communications</h2><p>Timesheets and approvals must be truthful and submitted under the correct account and period. Do not alter, delete, conceal, or approve records outside your assigned authority. Messages are for ordinary work coordination; formal announcements, deadlines, and required actions may be delivered through the application’s notification channels.</p></section>
    <section><h2 className="font-semibold text-slate-950">6. Applicable law and data transfers</h2><p>Use and disclosure of information must follow your organization’s instructions, contractual duties, and laws applicable to you and the information. This includes, where applicable, Kenya’s Data Protection Act, 2019, and relevant United States federal, state, and sector-specific privacy, security, and unauthorized-access laws. Do not transfer personal information across borders or disclose it to third parties unless authorized and supported by the safeguards your organization requires.</p></section>
    <section><h2 className="font-semibold text-slate-950">7. Monitoring, reporting, and access</h2><p>Security-relevant actions may be logged for access control, audit, troubleshooting, and incident response. Report service problems through the application’s issue-reporting controls and report urgent suspected security incidents directly to your organization. Access may be limited or suspended when needed to protect people, records, or the service.</p></section>
    <section><h2 className="font-semibold text-slate-950">8. Organization responsibility</h2><p>Your organization determines who may use its workspace and the purposes for which its records are processed. Follow its privacy notice, retention rules, and instructions. These Terms do not replace a data-processing agreement, privacy notice, or your organization’s policies, and do not promise that any software by itself makes an organization legally compliant.</p></section>
  </div>
}

export function TermsAcceptance({email}:{email:string}){
  const router=useRouter()
  const [confirmed,setConfirmed]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState("")
  async function accept(){
    setSaving(true);setError("")
    try{
      const response=await fetch(apiPath("/api/terms-of-use"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accepted:true,version:CURRENT_TERMS_VERSION})})
      const payload=await response.json()
      if(!response.ok)throw new Error(payload.error??"Could not record acceptance.")
      router.refresh()
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not record acceptance.")}
    finally{setSaving(false)}
  }
  return <main className="flex h-dvh min-h-dvh flex-col bg-slate-50 text-slate-950">
    <header className="flex shrink-0 items-center gap-3 border-b-2 border-orange-400 bg-white px-4 py-3"><ShieldCheck className="size-5 text-emerald-700"/><div><h1 className="font-semibold">Terms of Use</h1><p className="text-xs text-slate-600">Review required to enter Tanovo Time</p></div></header>
    <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-auto px-4 py-5 sm:px-8"><p className="mb-5 text-sm text-slate-600">Signed in as <strong className="text-slate-900">{email}</strong>. Read these rules before continuing.</p><TermsOfUseContent/></div>
    <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 flex-1 items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 size-4 accent-emerald-700"/><span>I have read and agree to follow these Terms of Use and my organization’s data-handling instructions.</span></label><Button disabled={!confirmed||saving} onClick={()=>void accept()}>{saving?<LoaderCircle className="size-4 animate-spin"/>:<Check className="size-4"/>}{saving?"Recording...":"Accept and continue"}</Button></div>{error&&<p role="alert" className="mx-auto mt-2 max-w-4xl text-sm text-red-700">{error}</p>}</footer>
  </main>
}
