/**
 * Shields the workspace while validating a restored or backgrounded session.
 * Real interaction renews idle time; polling/focus never count as user activity.
 * A warning preserves work briefly before server-enforced reauthentication.
 */
"use client"
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react"
import {WindowSurface} from "./window-surface"
import {Button} from "./ui/button"
import {SignOutButton} from "./sign-out-button"
import {apiPath,basePath} from "@/lib/paths"
import {invalidateClientData} from "@/lib/client-data-cache"
import {SESSION_WARNING_SECONDS,type AppSessionState} from "@/lib/session-policy"

/**
 * Applies idle warnings and prevents stale workspace display on browser restoration.
 * @param props.children - Existing role-aware app, retaining drafts during brief checks.
 * @param props.onExpired - Optional isolated-test callback instead of browser navigation.
 * @param props.accountEmail - Server-rendered principal, checked against restored sessions.
 * @returns JSX.Element with session privacy shield, warning and normal workspace.
 */
export function SessionBoundary({children,onExpired,accountEmail}:{children:ReactNode;onExpired?:()=>void;accountEmail?:string|null}){
  const [state,setState]=useState<AppSessionState|null>(null),[covered,setCovered]=useState(true),[error,setError]=useState("")
  const [showChecking,setShowChecking]=useState(false)
  const [remaining,setRemaining]=useState(Infinity),[busy,setBusy]=useState(false),[expired,setExpired]=useState(false)
  const [warningDismissed,setWarningDismissed]=useState(false)
  const clockOffset=useRef(0),pending=useRef(false),dirty=useRef(false),lastTouch=useRef(0),mounted=useRef(true)
  const ended=useRef(false)
  const warningVisible=useRef(false);warningVisible.current=!covered&&!warningDismissed&&remaining<=SESSION_WARNING_SECONDS*1000
  useLayoutEffect(()=>{
    if(covered)document.body.dataset.sessionChecking="true"
    else delete document.body.dataset.sessionChecking
    return()=>{delete document.body.dataset.sessionChecking}
  },[covered])
  useEffect(()=>{
    if(!covered||error){setShowChecking(false);return}
    const timer=window.setTimeout(()=>setShowChecking(true),1200)
    return()=>window.clearTimeout(timer)
  },[covered,error])
  const expire=useCallback(()=>{if(ended.current)return;ended.current=true;setExpired(true);invalidateClientData();if(onExpired)onExpired();else window.location.replace(`${basePath}?session=expired`)},[onExpired])
  /**
   * Checks authenticated server deadlines or submits a throttled activity signal.
   * @param interactive - Explicit real input or a Stay signed in confirmation.
   * @returns Promise<void> after authoritative state or a visible verification error.
   */
  const check=useCallback(async(interactive=false):Promise<void>=>{
    if(pending.current||ended.current)return
    pending.current=true;setBusy(true)
    try{
      const response=await fetch(apiPath("/api/session-activity"),{method:interactive?"POST":"GET",cache:"no-store",signal:AbortSignal.timeout(15000)})
      if(!mounted.current)return
      if(response.status===401||response.status===403){expire();return}
      const data=await response.json();if(!response.ok)throw new Error("Session verification unavailable. Retry before continuing.")
      if(accountEmail&&data.email!==accountEmail){expire();return}
      const server=Date.parse(data.serverTime),deadline=Date.parse(data.expiresAt)
      if(!Number.isFinite(server)||!Number.isFinite(deadline)||!Number.isFinite(Date.parse(data.absoluteExpiresAt)))throw new Error("Session verification unavailable. Retry before continuing.")
      clockOffset.current=server-Date.now();setState(data);setRemaining(Math.max(0,deadline-server));setCovered(false);setError("")
      if(interactive){dirty.current=false;lastTouch.current=Date.now()}
      if(deadline-server>SESSION_WARNING_SECONDS*1000)setWarningDismissed(false)
    }catch{if(mounted.current){setCovered(true);setError("Session verification unavailable. Retry before continuing.")}}
    finally{pending.current=false;if(mounted.current)setBusy(false)}
  },[expire,accountEmail])
  useEffect(()=>{
    mounted.current=true;void check()
    const activity=(event:Event)=>{if(document.visibilityState!=="visible"||!event.isTrusted||warningVisible.current)return;dirty.current=true;if(Date.now()-lastTouch.current>=60000)void check(true)}
    // Keep the active workspace mounted during routine resume checks. Expiry or
    // verification errors still cover it in check(), without flashing a modal.
    const visible=()=>{if(document.visibilityState==="visible")void check()}
    const resume=()=>{void check()}
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void check(dirty.current&&Date.now()-lastTouch.current>=60000)},15000)
    for(const name of ["pointerdown","keydown","wheel","touchstart"])window.addEventListener(name,activity,{passive:true})
    document.addEventListener("visibilitychange",visible);window.addEventListener("pageshow",resume)
    return()=>{mounted.current=false;window.clearInterval(timer);for(const name of ["pointerdown","keydown","wheel","touchstart"])window.removeEventListener(name,activity);document.removeEventListener("visibilitychange",visible);window.removeEventListener("pageshow",resume)}
  },[check])
  useEffect(()=>{
    if(!state)return
    const tick=()=>{const left=Date.parse(state.expiresAt)-(Date.now()+clockOffset.current);setRemaining(Math.max(0,left));if(left<=0)expire()}
    tick();const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer)
  },[state,expire])
  if(expired)return <p role="status" className="p-6">Session ended. Returning to sign in...</p>
  const hard=state&&Date.parse(state.absoluteExpiresAt)<=Date.parse(state.expiresAt)+1000
  return <>
    <div hidden={covered} inert={covered}>{children}</div>
    {covered&&(error||showChecking)&&<WindowSurface title="Session verification" sessionGuard disabled onBack={()=>{}}><section className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white p-6"><p role={error?"alert":"status"}>{error||"Checking your session..."}</p>{error&&<Button disabled={busy} onClick={()=>void check()}>Retry session check</Button>}</section></WindowSurface>}
    {!covered&&!warningDismissed&&remaining<=SESSION_WARNING_SECONDS*1000&&<WindowSurface title="Session ending soon" disabled={busy} onBack={()=>hard?setWarningDismissed(true):void check(true)}><section className="flex w-full flex-col bg-white"><header className="border-b p-4"><h2 className="font-semibold">{hard?"Please sign in again soon":"Still working?"}</h2></header><div className="space-y-3 p-4"><p>Your session ends in {Math.ceil(remaining/1000)} seconds.</p><p className="text-sm text-muted-foreground">{hard?"The eight-hour security limit cannot be extended. Save your work, then sign out and sign in again.":"Stay signed in to keep working. Background activity does not extend your session."}</p></div><footer className="flex flex-wrap justify-end gap-3 border-t p-4"><SignOutButton/>{hard?<Button disabled={busy} onClick={()=>setWarningDismissed(true)}>Return to work</Button>:<Button disabled={busy} onClick={()=>void check(true)}>{busy?"Checking...":"Stay signed in"}</Button>}</footer></section></WindowSurface>}
  </>
}
