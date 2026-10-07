/**
 * Provides technology-manager shortcuts for access administration and AI risks.
 * Existing entry management, approvals, reports, and audit tools remain available.
 * Permission changes stay in the existing explicit Edit and Save workflow.
 */
"use client"
import { ShieldCheck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Renders the technology administrator's operational navigation controls.
 * @param props.onDirectory - Callback opening employee and permission management.
 * @param props.onSecurity - Callback opening saved periodic AI security reports.
 * @returns JSX.Element containing technology-manager navigation buttons.
 */
export function AdminWorkspace({ onDirectory, onSecurity }: {
  onDirectory: () => void; onSecurity: () => void
}) {
  return <section aria-label="Technology management" className="border-y border-slate-200 bg-white py-4 text-slate-950">
    <h2 className="mb-3 text-base font-semibold">Technology management</h2>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="border-slate-300 bg-white text-slate-950" onClick={onDirectory}><Users className="size-4" />Employee access</Button>
      <Button variant="outline" className="border-slate-300 bg-white text-slate-950" onClick={onSecurity}><ShieldCheck className="size-4" />AI security reports</Button>
    </div>
  </section>
}
