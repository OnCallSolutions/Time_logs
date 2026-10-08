/**
 * Gives authentication forms accessible pending states and duplicate-click protection.
 * The enclosing form retains its existing server action and redirect behavior.
 * Microsoft uses its unmodified official symbol rather than a generic login icon.
 */
"use client"
import { useFormStatus } from "react-dom"
import { ArrowRight,Loader2,LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { basePath } from "@/lib/paths"

/**
 * Renders a sign-in or sign-out submit button using the parent form's status.
 * @param props.mode - Whether this control signs in or signs out.
 * @returns JSX.Element containing a protected submit button and live status.
 */
export function AuthSubmitButton({mode}:{mode:"signin"|"signout"}) {
  const {pending}=useFormStatus()
  const signingIn=mode==="signin"
  return <>
    <Button type="submit" disabled={pending} aria-busy={pending} variant="outline"
      className={signingIn ? "group h-12 w-full justify-between border-neutral-300 bg-white px-4 text-sm text-neutral-900 shadow-sm hover:border-primary hover:bg-neutral-50 focus-visible:ring-primary/30" : "h-9 w-36 gap-2 border-border bg-transparent px-3 hover:border-primary/40 hover:bg-accent hover:text-primary"}>
      {signingIn ? <>
        <span className="flex items-center gap-3">
          {pending?<Loader2 className="size-5 animate-spin" aria-hidden="true"/>:<img src={`${basePath}/microsoft-symbol.png`} width={19} height={19} alt=""/>}
          {pending?"Connecting to Microsoft...":"Sign in with Microsoft"}
        </span>
        {!pending&&<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true"/>}
      </> : <>{pending?<Loader2 className="size-4 animate-spin" aria-hidden="true"/>:<LogOut className="size-4" aria-hidden="true"/>}{pending?"Signing out...":"Sign out"}</>}
    </Button>
    <span role="status" className="sr-only">{pending?(signingIn?"Opening Microsoft sign-in.":"Ending your session."):""}</span>
  </>
}
