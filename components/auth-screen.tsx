/**
 * Provides the branded, responsive DevOnCall authentication surface.
 * Authentication actions are supplied by the existing server page unchanged.
 * Anonymous and unapproved identities share the same layout and support affordance.
 */
import { ArrowUpRight,LockKeyhole,ShieldCheck } from "lucide-react"
import { Brand } from "@/components/brand"
import { AuthSubmitButton } from "@/components/auth-submit-button"
import { SignOutButton } from "@/components/sign-out-button"
/**
 * Renders the sign-in form or a clear access-denied account state.
 * @param props.action - Existing Microsoft authentication server action.
 * @param props.email - Signed-in identity when app access is not approved.
 * @returns JSX.Element containing a practical authentication workspace.
 */
export function AuthScreen({action,email}:{action?:()=>Promise<void>;email?:string|null}) {
  const denied=!!email
  return <main className="auth-surface flex min-h-dvh flex-col">
    <header className="border-b border-border bg-white/95">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-5 sm:px-8"><Brand/><a href="https://www.devoncall.net/" target="_blank" rel="noreferrer" title="DevOnCall website" className="flex shrink-0 items-center gap-1 p-2 text-xs text-muted-foreground hover:text-primary"><span className="hidden sm:inline">Company</span><span className="sr-only sm:hidden">DevOnCall website</span><ArrowUpRight className="size-4" aria-hidden="true"/></a></div>
    </header>
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mb-6 flex items-center gap-2 text-xs font-medium uppercase text-primary"><span className="h-px w-8 bg-primary"/>{denied?"Account access":"Your workspace"}</div>
      <h1 className="text-3xl font-semibold leading-tight text-foreground">{denied?"Access not approved":"Sign in to TanovoTime"}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{denied?"Your Microsoft account is signed in, but access to this workspace has not been approved.":"Continue to your timesheet with your approved Microsoft account."}</p>
      <section className="mt-8 rounded-lg border border-border bg-white p-5 shadow-sm sm:p-6" aria-label="Account sign-in">
        <div className="mb-5 flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary" aria-hidden="true"/>{denied?"Signed-in account":"Microsoft account"}</div>
        {denied?<><p className="mb-5 break-words text-sm text-foreground">{email}</p><SignOutButton/></>:<form action={action}><AuthSubmitButton mode="signin"/></form>}
        <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-emerald-700" aria-hidden="true"/>{denied?"Contact your technology manager for access.":"Your password stays with Microsoft."}</div>
      </section>
      <details className="mt-5 text-sm text-muted-foreground">
        <summary className="cursor-pointer rounded-sm py-2 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">Need help signing in?</summary>
        <p className="mt-2 text-xs leading-6">Use the account approved by your technology manager. If Microsoft rejects the account, check its organization access with your manager.</p>
      </details>
    </div>
    <footer className="border-t border-border bg-white px-5 py-4 text-center text-xs text-muted-foreground">DevOnCall / TanovoTime</footer>
  </main>
}
