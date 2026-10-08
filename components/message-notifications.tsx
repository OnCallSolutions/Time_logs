/**
 * Presents private incoming-message alerts and optional browser-generated sounds.
 * Alerts never disclose message bodies. Sound is enabled only through a user click;
 * settings are scoped to the signed-in account and no OS permission is requested.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { Bell, Volume2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MessageInbox } from "@/components/use-message-inbox"

/**
 * Shows unread indicators and new-message popups while any workspace view is open.
 * @param props.inbox - Shell-owned scoped inbox and notification state.
 * @param props.onOpen - Callback navigating to the message workspace.
 * @returns JSX.Element containing notification preferences and privacy-safe alerts.
 */
export function MessageNotifications({inbox,onOpen}:{inbox:MessageInbox;onOpen:()=>void}) {
  const [sound,setSound]=useState(false)
  const [popup,setPopup]=useState(true)
  const [audioError,setAudioError]=useState<string|null>(null)
  const audio=useRef<AudioContext|null>(null)
  const last=useRef<string|null>(null)
  useEffect(()=>{
    if(!inbox.email)return
    try{const stored=JSON.parse(localStorage.getItem(`message-alerts:${inbox.email}`)??"{}");setSound(stored.sound===true);setPopup(stored.popup!==false)}catch{}
  },[inbox.email])
  useEffect(()=>()=>{void audio.current?.close()},[])
  useEffect(()=>{
    if(!inbox.notification||last.current===inbox.notification.id)return
    last.current=inbox.notification.id
    if(sound&&audio.current?.state==="running"){
      const context=audio.current;const oscillator=context.createOscillator();const gain=context.createGain()
      oscillator.frequency.value=660;gain.gain.setValueAtTime(0.08,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.18)
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+0.2)
    }
  },[inbox.notification,sound])
  /** @param nextSound - Whether optional sound is enabled. @param nextPopup - Whether in-app popups are enabled. @returns void after account-scoped preference persistence. */
  function save(nextSound:boolean,nextPopup:boolean):void{
    setSound(nextSound);setPopup(nextPopup)
    try{localStorage.setItem(`message-alerts:${inbox.email}`,JSON.stringify({sound:nextSound,popup:nextPopup}))}catch{}
  }
  /**
   * Resumes notification audio only in a user-initiated browser interaction.
   * @returns Promise<boolean> indicating that audio is available for this session.
   */
  async function enableAudio():Promise<boolean>{
    try{audio.current??=new AudioContext();await audio.current.resume();setAudioError(null);return true}
    catch{setAudioError("Sound is unavailable in this browser session.");return false}
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" onClick={onOpen} title="Open messages"><Bell className="size-4"/>Messages{inbox.unread>0&&<span className="rounded-full bg-primary px-1.5 text-xs text-white" aria-label={`${inbox.unread} unread messages`}>{inbox.unread}</span>}</Button>
    <details className="relative text-xs"><summary className="cursor-pointer text-muted-foreground">Notifications</summary><div className="absolute right-0 z-20 mt-2 grid w-52 gap-3 rounded-md border bg-popover p-3 shadow-md">
      <label className="flex items-center gap-2"><input type="checkbox" checked={popup} onChange={event=>save(sound,event.target.checked)}/>Message popups</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={async event=>{const enabled=event.target.checked;if(enabled&&!await enableAudio())return;save(enabled,popup)}}/><Volume2 className="size-3"/>Message sound</label>
      {sound&&<Button size="sm" variant="outline" onClick={enableAudio}>Enable sound this session</Button>}
      {audioError&&<p role="alert" className="text-xs text-destructive">{audioError}</p>}
    </div></details>
    {popup&&inbox.notification&&<div role="status" className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-border bg-white p-3 shadow-lg"><Bell className="size-4 shrink-0 text-primary"/><div className="min-w-0"><p className="text-sm font-medium">New message</p><p className="truncate text-xs text-muted-foreground">{inbox.notification.sender_email}</p></div><Button size="sm" variant="outline" onClick={()=>{inbox.dismissNotification();onOpen()}}>Open</Button><Button size="icon-sm" variant="ghost" title="Dismiss message notification" aria-label="Dismiss message notification" onClick={inbox.dismissNotification}><X className="size-4"/></Button></div>}
  </div>
}
