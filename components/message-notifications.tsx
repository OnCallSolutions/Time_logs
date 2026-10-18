/**
 * Combines deadline alerts with private-message and announcement activity
 * without exposing encrypted message content in the notification center.
 */
"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, CheckCheck, Megaphone, MessageSquare, Volume2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { MessageInbox } from "@/components/use-message-inbox"
type PeriodReminder={id:string;title:string;body:string;sender_label:string;created_at:string;read_at:string|null}

/** @param props.inbox - Signed-in account inbox with unread and new-message state. @param props.onOpen - Opens the message workspace. @returns JSX for the notification launcher, center and private toast. */
export function MessageNotifications({inbox,onOpen}:{inbox:MessageInbox;onOpen:()=>void}) {
  const [sound,setSound]=useState(false)
  const [popup,setPopup]=useState(true)
  const [audioError,setAudioError]=useState<string|null>(null)
  const [actionError,setActionError]=useState<string|null>(null)
  const [centerOpen,setCenterOpen]=useState(false)
  const [markingRead,setMarkingRead]=useState(false)
  const [periodReminders,setPeriodReminders]=useState<PeriodReminder[]>([])
  const audio=useRef<AudioContext|null>(null)
  const last=useRef<string|null>(null)
  const playTone=useCallback(()=>{
    const context=audio.current
    if(!context||context.state!=="running")return
    const oscillator=context.createOscillator();const gain=context.createGain()
    oscillator.frequency.value=660;gain.gain.setValueAtTime(0.08,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.18)
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+0.2)
  },[])
  useEffect(()=>{
    if(!inbox.email)return
    try{const stored=JSON.parse(localStorage.getItem(`message-alerts:${inbox.email}`)??"{}");setSound(stored.sound===true);setPopup(stored.popup!==false)}catch{}
  },[inbox.email])
  useEffect(()=>()=>{void audio.current?.close()},[])
  useEffect(()=>{
    if(!inbox.email)return
    let active=true
    const load=()=>fetch(apiPath("/api/timesheet-period-reminders"),{cache:"no-store"}).then(async response=>{const data=await response.json();if(response.ok&&active)setPeriodReminders(data.reminders??[])}).catch(()=>{})
    void load();const timer=window.setInterval(()=>void load(),60_000)
    return()=>{active=false;window.clearInterval(timer)}
  },[inbox.email])
  useEffect(()=>{
    if(!inbox.notification||last.current===inbox.notification.id)return
    last.current=inbox.notification.id
    if(sound)playTone()
  },[inbox.notification,sound,playTone])
  /** @param nextSound - Whether optional sound is enabled. @param nextPopup - Whether in-app popups are enabled. @returns void after account-scoped preference persistence. */
  function save(nextSound:boolean,nextPopup:boolean):void{
    setSound(nextSound);setPopup(nextPopup)
    try{localStorage.setItem(`message-alerts:${inbox.email}`,JSON.stringify({sound:nextSound,popup:nextPopup}))}catch{}
  }
  /** Resumes notification audio only after a user gesture. @returns Promise<boolean> indicating session audio availability. */
  async function enableAudio():Promise<boolean>{
    try{audio.current??=new AudioContext();await audio.current.resume();setAudioError(null);return true}
    catch{setAudioError("Sound is unavailable in this browser session.");return false}
  }
  /** Acknowledges all currently loaded unread incoming messages in API-sized batches. @returns Promise<void> after the inbox is refreshed. */
  async function markAllRead():Promise<void>{
    const reminderIds=periodReminders.filter(reminder=>!reminder.read_at).map(reminder=>reminder.id)
    const unreadMessages=inbox.messages.filter(message=>message.sender_email.toLowerCase()!==inbox.email.toLowerCase()&&!message.deleted_at&&!message.read_at)
    if((!reminderIds.length&&!unreadMessages.length)||markingRead)return
    setMarkingRead(true);setActionError(null)
    try{
      const [reminderResult,messageResult]=await Promise.all([
        reminderIds.length?fetch(apiPath("/api/timesheet-period-reminders"),{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:reminderIds})}):Promise.resolve(null),
        unreadMessages.length?fetch(apiPath("/api/messages"),{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read",ids:unreadMessages.map(message=>message.id)})}):Promise.resolve(null),
      ])
      const now=new Date().toISOString()
      if(reminderResult?.ok)setPeriodReminders(previous=>previous.map(reminder=>({...reminder,read_at:reminder.read_at??now})))
      if(messageResult?.ok){inbox.refresh();inbox.dismissNotification()}
      if(reminderResult&&!reminderResult.ok||messageResult&&!messageResult.ok)setActionError("Some notifications could not be marked as read. Refresh and retry.")
    }catch{setActionError("Notifications could not be updated. Refresh and retry.")}
    finally{setMarkingRead(false)}
  }
  const unreadMessages=inbox.messages.filter(message=>message.sender_email.toLowerCase()!==inbox.email.toLowerCase()&&!message.deleted_at&&!message.read_at)
  const unreadCount=periodReminders.filter(reminder=>!reminder.read_at).length+unreadMessages.length
  function openMessages():void{setCenterOpen(false);inbox.dismissNotification();onOpen()}
  return <>
    <Button variant="ghost" size="icon-lg" aria-label={`Notifications, ${unreadCount} unread`} title="Notifications" className="relative" onClick={()=>setCenterOpen(true)}>
      <Bell className="size-5" aria-hidden="true"/>
      {unreadCount>0&&<span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-semibold text-white">{unreadCount>99?"99+":unreadCount}</span>}
    </Button>
    {centerOpen&&<WindowSurface title="Notification center" onBack={()=>setCenterOpen(false)}>
      <section className="flex min-h-0 w-full flex-col overflow-hidden bg-white text-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-4 py-3">
          <div><h2 className="font-semibold">Notifications</h2><p className="text-xs text-orange-950">{unreadCount} unread across messages and deadlines</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!unreadCount||markingRead} onClick={()=>void markAllRead()}><CheckCheck className="size-4"/>{markingRead?"Updating...":"Mark all as read"}</Button></div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Messages and announcements</h3>
          {unreadMessages.length===0?<p className="border-y border-slate-200 py-4 text-center text-sm text-slate-600">No unread messages or announcements.</p>:<ul className="mb-5 divide-y divide-sky-200 rounded-md border border-sky-200 bg-sky-50/60">{unreadMessages.slice(0,50).map(message=>{const announcement=!message.recipient_email;return <li key={message.id} className={`border-l-4 px-3 py-3 ${announcement?"border-orange-500 bg-orange-50/70":"border-sky-500 bg-white/80"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-sm font-semibold">{announcement?<Megaphone className="size-4 text-orange-700"/>:<MessageSquare className="size-4 text-sky-700"/>}{announcement?"Announcement":"Message"}<span className="ml-1 text-xs font-normal text-slate-600">from {message.sender_name||message.author_name||"Organization"}</span></p><time className="text-xs text-slate-500">{formatNotificationDate(message.created_at)}</time></div><p className="mt-1 text-xs text-slate-600">{message.priority==="high"?"High priority · ":""}{announcement?"Organization-wide update":"Private message"}</p><Button size="sm" variant="outline" className="mt-2" onClick={openMessages}><MessageSquare className="size-3.5"/>Open messages</Button></li>})}</ul>}
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Timesheet deadline alerts</h3>
          {periodReminders.length===0?<p className="border-y border-slate-200 py-5 text-center text-sm text-slate-600">No deadline reminders.</p>:<ul className="divide-y divide-slate-200">{periodReminders.slice(0,50).map(reminder=><li key={reminder.id} className={`py-3 ${reminder.read_at?"opacity-70":"bg-orange-50/60"}`}><p className="text-sm font-medium">{reminder.title}<span className="ml-2 text-xs font-normal text-orange-800">{reminder.sender_label}</span></p><p className="mt-1 text-sm text-slate-700">{reminder.body}</p><p className="mt-1 text-xs text-slate-500">{formatNotificationDate(reminder.created_at)}</p></li>)}</ul>}
          {actionError&&<p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}
          <section aria-labelledby="notification-preferences-title" className="mt-5 border-t border-slate-200 pt-4">
            <h3 id="notification-preferences-title" className="mb-3 text-sm font-semibold">Message alert preferences</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={popup} onChange={event=>save(sound,event.target.checked)}/>Message popups</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={async event=>{const enabled=event.target.checked;if(enabled&&!await enableAudio())return;save(enabled,popup)}}/><Volume2 className="size-4"/>Message sound</label>
            </div>
            <Button size="sm" variant="outline" className="mt-3" onClick={async()=>{if(await enableAudio())playTone()}}><Volume2 className="size-4"/>Test sound</Button>
            {audioError&&<p role="alert" className="mt-2 text-xs text-red-700">{audioError}</p>}
          </section>
        </div>
      </section>
    </WindowSurface>}
    {popup&&inbox.notification&&<div role="status" className={`fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-white p-3 shadow-lg ${inbox.notification.recipient_email?"border-sky-200":"border-orange-300"}`}>{inbox.notification.recipient_email?<MessageSquare className="size-4 shrink-0 text-sky-700"/>:<Megaphone className="size-4 shrink-0 text-orange-700"/>}<div className="min-w-0"><p className="text-sm font-medium">{inbox.notification.recipient_email?(inbox.notification.priority==="high"?"High-priority message":"New message"):"New announcement"}</p><p className="truncate text-xs text-muted-foreground">{inbox.notification.sender_name||inbox.notification.author_name||"Organization"}</p></div><Button size="sm" variant="outline" onClick={openMessages}>Open</Button><Button size="icon-sm" variant="ghost" title="Dismiss message notification" aria-label="Dismiss message notification" onClick={inbox.dismissNotification}><X className="size-4"/></Button></div>}
  </>
}

/** Formats message timestamps for the private notification list. @param value - ISO timestamp from the message API. @returns Local date and time, or a safe fallback. */
function formatNotificationDate(value:string):string{
  const date=new Date(value)
  return Number.isNaN(date.getTime())?"Time unavailable":new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date)
}
