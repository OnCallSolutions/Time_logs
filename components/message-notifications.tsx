/**
 * Combines deadline alerts with private-message and announcement activity
 * without exposing encrypted message content in the notification center.
 */
"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, CalendarClock, CheckCheck, Megaphone, MessageSquare, Search, Settings, Volume2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { apiPath } from "@/lib/paths"
import type { MessageInbox } from "@/components/use-message-inbox"
type PeriodReminder={id:string;title:string;body:string;sender_label:string;created_at:string;read_at:string|null}
type ReminderPolicy={mode:"automatic"|"manual";timezone:string;workerInitialTime:string;workerHardTime:string;managerInitialTime:string;managerHardTime:string;accountManagerTime:string;updatedBy:string|null;updatedAt:string|null}
type TimesheetPeriod={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string;managerSubmissionDeadline?:string;accountApprovalDeadline?:string;exceptionResolutionDeadline?:string;timezone:string;reminderDays:number}
type SubmissionCompliance={periodId:string;periodName:string;startDate:string;endDate:string;dueAt:string;email:string;displayName:string;projects:string[];managerEmail:string|null;managerName:string|null;submittedAt:string|null;status:"missing"|"overdue"|"submitted"|"late";hardReminderSent:boolean;manualHardReminderPending:boolean}
type ScheduleIssue={id:string;message:string;firstSeenAt:string;lastSeenAt:string}

/** @param props.inbox - Signed-in account inbox with unread and new-message state. @param props.onOpen - Opens the message workspace. @returns JSX for the notification launcher, center and private toast. */
export function MessageNotifications({inbox,onOpen,onManagePeriods,messagesOpen=false}:{inbox:MessageInbox;onOpen:()=>void;onManagePeriods?:()=>void;messagesOpen?:boolean}) {
  const [sound,setSound]=useState(false)
  const [popup,setPopup]=useState(true)
  const [audioError,setAudioError]=useState<string|null>(null)
  const [actionError,setActionError]=useState<string|null>(null)
  const [centerOpen,setCenterOpen]=useState(false)
  const [activeTab,setActiveTab]=useState<"announcements"|"timesheets">("timesheets")
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [markingRead,setMarkingRead]=useState(false)
  const [periodReminders,setPeriodReminders]=useState<PeriodReminder[]>([])
  const [submissionCompliance,setSubmissionCompliance]=useState<SubmissionCompliance[]>([])
  const [periods,setPeriods]=useState<TimesheetPeriod[]>([])
  const [scheduleIssues,setScheduleIssues]=useState<ScheduleIssue[]>([])
  const [canViewCompliance,setCanViewCompliance]=useState(false)
  const [canManagePolicy,setCanManagePolicy]=useState(false)
  const [canManagePeriods,setCanManagePeriods]=useState(false)
  const [notificationSearch,setNotificationSearch]=useState("")
  const [reminderPolicy,setReminderPolicy]=useState<ReminderPolicy|null>(null)
  const [reminderDraft,setReminderDraft]=useState<ReminderPolicy|null>(null)
  const [editingReminder,setEditingReminder]=useState(false)
  const [selectedPeriodId,setSelectedPeriodId]=useState("")
  const [policySaving,setPolicySaving]=useState(false)
  const [actionNotice,setActionNotice]=useState<string|null>(null)
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
    const load=()=>fetch(apiPath("/api/timesheet-period-reminders"),{cache:"no-store"}).then(async response=>{const data=await response.json();if(response.ok&&active){setPeriodReminders(data.reminders??[]);setSubmissionCompliance(data.compliance??[]);setCanViewCompliance(data.canViewCompliance===true);setCanManagePolicy(data.canManagePolicy===true);setCanManagePeriods(data.canManagePeriods===true);setPeriods(data.periods??[]);setScheduleIssues(data.scheduleIssues??[]);if(data.policy&&!editingReminder){setReminderPolicy(data.policy);setReminderDraft(data.policy)}if(data.periods?.length&&!selectedPeriodId){const today=new Date().toISOString().slice(0,10);setSelectedPeriodId(data.periods.find((period:TimesheetPeriod)=>today>=period.startDate&&today<=period.endDate)?.id??data.periods[0].id)}}}).catch(()=>{})
    void load();const timer=window.setInterval(()=>void load(),60_000)
    return()=>{active=false;window.clearInterval(timer)}
  },[inbox.email,editingReminder,selectedPeriodId])
  useEffect(()=>{
    if(!inbox.notification||last.current===inbox.notification.id)return
    last.current=inbox.notification.id
    if(sound)playTone()
  },[inbox.notification,sound,playTone])
  /** @param nextSound - Whether optional sound is enabled. @param nextPopup - Whether in-app popups are enabled. @returns void after account-scoped preference persistence. */
  function saveMessageAlerts(nextSound:boolean,nextPopup:boolean):void{
    setSound(nextSound);setPopup(nextPopup)
    try{localStorage.setItem(`message-alerts:${inbox.email}`,JSON.stringify({sound:nextSound,popup:nextPopup}))}catch{}
  }
  /** Resumes notification audio only after a user gesture. @returns Promise<boolean> indicating session audio availability. */
  async function enableAudio():Promise<boolean>{
    try{audio.current??=new AudioContext();await audio.current.resume();setAudioError(null);return true}
    catch{setAudioError("Sound is unavailable in this browser session.");return false}
  }
  /** Marks only timesheet alerts read; message receipts remain in Messages. */
  async function markAlertsRead():Promise<void>{
    const reminderIds=periodReminders.filter(reminder=>!reminder.read_at).map(reminder=>reminder.id)
    if(!reminderIds.length||markingRead)return
    setMarkingRead(true);setActionError(null)
    try{
      const result=await fetch(apiPath("/api/timesheet-period-reminders"),{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:reminderIds})})
      if(!result.ok)throw new Error("Alerts could not be marked as read. Refresh and retry.")
      const now=new Date().toISOString()
      setPeriodReminders(previous=>previous.map(reminder=>({...reminder,read_at:reminder.read_at??now})))
    }catch(cause){setActionError(cause instanceof Error?cause.message:"Alerts could not be updated.")}
    finally{setMarkingRead(false)}
  }
  const announcements=inbox.messages.filter(message=>!message.recipient_email&&message.sender_email.toLowerCase()!==inbox.email.toLowerCase()&&!message.deleted_at)
  const unreadAnnouncements=announcements.filter(message=>!message.read_at)
  const normalizedSearch=notificationSearch.trim().toLowerCase()
  const visibleAnnouncements=announcements.filter(message=>[message.sender_name,message.author_name,message.sender_email].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch))
  const visibleReminders=periodReminders.filter(reminder=>[reminder.title,reminder.body,reminder.sender_label].join(" ").toLowerCase().includes(normalizedSearch))
  const visibleCompliance=submissionCompliance.filter(item=>[item.displayName,item.email,item.managerName,...item.projects].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch))
  const unreadAlerts=periodReminders.filter(reminder=>!reminder.read_at).length
  const unreadCount=unreadAlerts+unreadAnnouncements.length
  const currentPeriod=periods.find(period=>period.id===selectedPeriodId)??periods[0]
  const policy=editingReminder?reminderDraft:reminderPolicy
  function openMessages():void{setCenterOpen(false);inbox.dismissNotification();onOpen()}
  async function saveReminderPolicy():Promise<void>{
    if(!reminderDraft||policySaving)return
    setPolicySaving(true);setActionError(null)
    try{
      const response=await fetch(apiPath("/api/timesheet-period-reminders"),{method:"PATCH",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:reminderDraft.mode,timezone:reminderDraft.timezone,workerInitialTime:reminderDraft.workerInitialTime,workerHardTime:reminderDraft.workerHardTime,managerInitialTime:reminderDraft.managerInitialTime,managerHardTime:reminderDraft.managerHardTime,accountManagerTime:reminderDraft.accountManagerTime})})
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Reminder policy could not be saved.")
      setReminderPolicy(data.policy);setReminderDraft(data.policy);setEditingReminder(false);setActionError(null);setActionNotice("Reminder settings saved.")
    }catch(cause){setActionError(cause instanceof Error?cause.message:"Reminder policy could not be saved.")}
    finally{setPolicySaving(false)}
  }
  async function sendDueReminders():Promise<void>{
    setMarkingRead(true);setActionError(null)
    try{const response=await fetch(apiPath("/api/timesheet-period-reminders"),{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send_due"})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Due reminders could not be sent.");setActionNotice(`${data.sent} reminders sent.`)}
    catch(cause){setActionError(cause instanceof Error?cause.message:"Due reminders could not be sent.")}
    finally{setMarkingRead(false)}
  }
  const reminderSchedule=currentPeriod&&policy?[
    ["Employee / contractor initial",currentPeriod.submissionDeadline,currentPeriod.reminderDays,policy.workerInitialTime],
    ["Employee / contractor hard",currentPeriod.submissionDeadline,0,policy.workerHardTime],
    ["Manager initial",currentPeriod.submissionDeadline,0,policy.managerInitialTime],
    ["Manager hard",currentPeriod.managerSubmissionDeadline??currentPeriod.submissionDeadline,0,policy.managerHardTime],
    ["Account manager",currentPeriod.accountApprovalDeadline??currentPeriod.submissionDeadline,0,policy.accountManagerTime],
    ["Exception cutoff",currentPeriod.exceptionResolutionDeadline??currentPeriod.accountApprovalDeadline??currentPeriod.submissionDeadline,0,policy.accountManagerTime],
  ] as const:[]
  return <>
    <Button variant="ghost" size="icon-lg" aria-label={`Notifications, ${unreadCount} unread`} title="Notifications" className="relative" onClick={()=>setCenterOpen(true)}>
      <Bell className="size-5" aria-hidden="true"/>
      {unreadCount>0&&<span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-semibold text-white">{unreadCount>99?"99+":unreadCount}</span>}
    </Button>
    {centerOpen&&<WindowSurface title="Notification center" onBack={()=>setCenterOpen(false)}>
      <section className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-950">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-orange-200 bg-orange-50 px-3 py-2">
          <div><h2 className="text-sm font-semibold">Notifications</h2><p className="text-[11px] text-orange-950">{unreadCount} unread notifications</p></div>
          <div className="flex items-center gap-1">{activeTab==="timesheets"&&<Button variant="outline" size="sm" title="Mark deadline alerts as read" disabled={!unreadAlerts||markingRead} onClick={()=>void markAlertsRead()}><CheckCheck className="size-4"/>{markingRead?"Updating…":"Mark alerts read"}</Button>}<Button variant="outline" size="icon" aria-label="Notification settings" title="Notification settings" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(value=>!value)}><Settings className="size-4"/></Button></div>
        </header>
        <nav aria-label="Notification sections" className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-1"><button type="button" aria-pressed={activeTab==="announcements"} onClick={()=>setActiveTab("announcements")} className={`border-b-2 px-3 py-2 text-xs font-semibold ${activeTab==="announcements"?"border-orange-600 text-orange-950":"border-transparent text-slate-600 hover:bg-orange-50"}`}><Megaphone className="mr-1 inline size-3.5"/>Announcements{unreadAnnouncements.length>0&&<span className="ml-1 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] text-white">{unreadAnnouncements.length}</span>}</button><button type="button" aria-pressed={activeTab==="timesheets"} onClick={()=>setActiveTab("timesheets")} className={`border-b-2 px-3 py-2 text-xs font-semibold ${activeTab==="timesheets"?"border-sky-600 text-sky-950":"border-transparent text-slate-600 hover:bg-sky-50"}`}><CalendarClock className="mr-1 inline size-3.5"/>Timesheet alerts{unreadAlerts>0&&<span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] text-white">{unreadAlerts}</span>}</button></nav>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4">
          <label className="relative mb-3 block"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-slate-500"/><input aria-label="Search notification section" type="search" value={notificationSearch} onChange={event=>setNotificationSearch(event.target.value)} placeholder={activeTab==="announcements"?"Search announcements…":"Search alerts and patrons…"} className="h-8 w-full border border-slate-300 bg-white pl-9 pr-3 text-sm"/></label>
          {activeTab==="announcements"&&<section aria-label="Announcements">{visibleAnnouncements.length===0?<p className="border-y border-slate-200 py-6 text-center text-sm text-slate-600">No announcements match this search.</p>:<ul className="divide-y divide-orange-200 border-y border-orange-200">{visibleAnnouncements.map(message=><li key={message.id} className="flex flex-wrap items-center justify-between gap-2 bg-orange-50/40 px-3 py-2"><div className="flex min-w-0 items-center gap-2"><Megaphone className="size-4 shrink-0 text-orange-700"/><div className="min-w-0"><p className="text-sm font-medium">{message.sender_name||message.author_name||"Organization"}{!message.read_at&&<span className="ml-2 text-[10px] font-semibold uppercase text-orange-700">New</span>}</p><p className="text-[11px] text-slate-600">{message.priority==="high"?"High priority · ":""}Announcement · {formatNotificationDate(message.created_at)}</p></div></div><Button size="sm" variant="outline" onClick={openMessages}><MessageSquare className="size-3.5"/>Open in Messages</Button></li>)}</ul>}</section>}
          {activeTab==="timesheets"&&<section aria-label="Timesheet alerts" className="space-y-3">{scheduleIssues.length>0&&<section aria-label="Unresolved timesheet schedule issues" className="border border-red-300 bg-red-50 px-3 py-2"><h3 className="text-sm font-semibold text-red-900">Timesheet schedule needs attention · {scheduleIssues.length}</h3><ul className="mt-1 space-y-1 text-xs text-red-900">{scheduleIssues.map(issue=><li key={issue.id}>{issue.message}</li>)}</ul></section>}<div>{visibleReminders.length===0?<p className="border-y border-slate-200 py-5 text-center text-sm text-slate-600">No deadline alerts match this search.</p>:<ul className="divide-y divide-slate-200 border-y border-slate-200">{visibleReminders.map(reminder=><li key={reminder.id} className={`px-2 py-2 ${reminder.read_at?"opacity-70":"bg-orange-50/50"}`}><p className="text-sm font-medium">{reminder.title}<span className="ml-2 text-xs font-normal text-orange-800">{reminder.sender_label}</span></p><p className="text-xs text-slate-700">{reminder.body}</p><p className="text-[11px] text-slate-500">{formatNotificationDate(reminder.created_at)}</p></li>)}</ul>}</div>
          {canViewCompliance&&<section aria-label="Timesheet submission tracker" className="mt-4 border border-sky-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2"><div><h3 className="text-sm font-semibold text-sky-950">Submission tracker{submissionCompliance[0]?` · ${submissionCompliance[0].periodName}`:""}</h3><p className="text-xs text-slate-600">Expected workers with active project assignments for this period.</p></div><div className="flex gap-3 text-xs"><span>{submissionCompliance.filter(item=>item.status==="submitted"||item.status==="late").length} submitted</span><span className="font-semibold text-red-700">{submissionCompliance.filter(item=>item.status==="missing"||item.status==="overdue").length} outstanding</span></div></header>
            {visibleCompliance.length===0?<p className="px-3 py-4 text-sm text-slate-600">{submissionCompliance.length?"No expected patrons match this search.":"No active period or project-assigned patrons are currently expected to submit."}</p>:<div className="max-h-72 overflow-auto overscroll-contain"><table className="w-full min-w-[680px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th className="px-3 py-2">Patron</th><th className="px-3 py-2">Projects</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Hard reminder</th></tr></thead><tbody className="divide-y divide-slate-200">{visibleCompliance.map(item=><tr key={`${item.periodId}:${item.email}`} className={item.status==="overdue"||item.status==="late"?"bg-red-50/60":""}><td className="px-3 py-2"><span className="font-medium">{item.displayName}</span><span className="block text-slate-500">{item.email}</span></td><td className="max-w-56 px-3 py-2">{item.projects.join(", ")}</td><td className="px-3 py-2">{item.managerName??"Not assigned"}</td><td className="whitespace-nowrap px-3 py-2">{formatNotificationDate(item.dueAt)}</td><td className={`px-3 py-2 font-semibold ${item.status==="overdue"||item.status==="late"?"text-red-700":item.status==="submitted"?"text-emerald-700":"text-amber-800"}`}>{item.status==="overdue"?"Overdue":item.status==="late"?"Submitted late":item.status==="submitted"?"Submitted":"Not submitted"}</td><td className="px-3 py-2">{item.hardReminderSent?"Sent":item.manualHardReminderPending?"Manual action due":"Not due"}</td></tr>)}</tbody></table></div>}
          </section>}
          {currentPeriod&&<section aria-label="Reminder schedule" className="mt-4 border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"><div><h3 className="text-sm font-semibold">Reminder schedule</h3><p className="text-xs text-slate-600">{currentPeriod.name} · {currentPeriod.timezone}</p></div><label className="flex items-center gap-2 text-xs">Period<select aria-label="Schedule period" value={currentPeriod.id} onChange={event=>setSelectedPeriodId(event.target.value)} className="h-8 max-w-64 border border-slate-300 bg-white px-2">{periods.map(period=><option key={period.id} value={period.id}>{period.name}</option>)}</select></label></header>
            {reminderSchedule.length?<div className="divide-y divide-slate-100">{reminderSchedule.map(([label,deadline,days,time])=><div key={label} className="grid grid-cols-[minmax(9rem,1fr)_minmax(12rem,2fr)] gap-2 px-3 py-2 text-xs"><span className="font-medium text-slate-700">{label}</span><span>{formatReminderSchedule(deadline,days,time,currentPeriod.timezone)}</span></div>)}</div>:<p className="px-3 py-4 text-sm text-slate-600">Reminder schedule is not configured.</p>}
          </section>}
          {actionError&&<p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}{actionNotice&&<p role="status" className="mt-3 text-sm text-emerald-700">{actionNotice}</p>}
          </section>}
        </div>
        {settingsOpen&&<aside aria-label="Notification settings" className="absolute right-3 top-12 z-30 max-h-[calc(100%-4rem)] w-[min(30rem,calc(100%-1.5rem))] overflow-auto border border-slate-300 bg-white p-3 shadow-xl">
          <header className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Settings</h3><Button size="icon-sm" variant="ghost" aria-label="Close notification settings" onClick={()=>setSettingsOpen(false)}><X className="size-4"/></Button></header>
          <section aria-label="Message alert preferences" className="border-b border-slate-200 pb-3"><h4 className="mb-2 text-xs font-semibold uppercase text-slate-600">Message alerts</h4><div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={popup} onChange={event=>saveMessageAlerts(sound,event.target.checked)}/>Pop-up</label><label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={async event=>{const enabled=event.target.checked;if(enabled&&!await enableAudio())return;saveMessageAlerts(enabled,popup)}}/><Volume2 className="size-4"/>Sound</label><Button size="sm" variant="outline" onClick={async()=>{if(await enableAudio())playTone()}}><Volume2 className="size-4"/>Test sound</Button></div>{audioError&&<p role="alert" className="mt-2 text-xs text-red-700">{audioError}</p>}</section>
          {activeTab==="timesheets"&&canManagePolicy&&reminderPolicy&&<section aria-label="Timesheet reminder settings" className="border-b border-slate-200 py-3"><div className="mb-2 flex items-center justify-between gap-2"><div><h4 className="text-xs font-semibold uppercase text-slate-600">Reminder delivery</h4><p className="text-xs text-slate-500">{reminderPolicy.mode==="automatic"?"Automatic":"Manual"} · organization-wide times</p></div>{!editingReminder&&<Button size="sm" variant="outline" onClick={()=>{setReminderDraft(reminderPolicy);setEditingReminder(true)}}>Edit</Button>}</div>
            {editingReminder&&reminderDraft?<><div className="mb-3 inline-flex border border-slate-300 bg-white p-0.5"><button type="button" aria-pressed={reminderDraft.mode==="automatic"} onClick={()=>setReminderDraft({...reminderDraft,mode:"automatic"})} className={`px-2 py-1 text-xs ${reminderDraft.mode==="automatic"?"bg-sky-100 font-semibold":""}`}>Automatic</button><button type="button" aria-pressed={reminderDraft.mode==="manual"} onClick={()=>setReminderDraft({...reminderDraft,mode:"manual"})} className={`px-2 py-1 text-xs ${reminderDraft.mode==="manual"?"bg-orange-100 font-semibold":""}`}>Manual</button></div><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs">Timezone<input value={reminderDraft.timezone} onChange={event=>setReminderDraft({...reminderDraft,timezone:event.target.value})} className="h-8 border border-slate-300 px-2"/></label>{([["workerInitialTime","Worker initial"],["workerHardTime","Worker hard"],["managerInitialTime","Manager initial"],["managerHardTime","Manager hard"],["accountManagerTime","Account manager"]] as const).map(([key,label])=><label key={key} className="grid gap-1 text-xs">{label}<input type="time" value={reminderDraft[key]} onChange={event=>setReminderDraft({...reminderDraft,[key]:event.target.value})} className="h-8 border border-slate-300 px-2"/></label>)}</div><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>{setReminderDraft(reminderPolicy);setEditingReminder(false)}}>Cancel</Button><Button size="sm" disabled={policySaving} onClick={()=>void saveReminderPolicy()}>{policySaving?"Saving…":"Save"}</Button></div></>:reminderPolicy.mode==="manual"&&<Button size="sm" variant="outline" disabled={markingRead} onClick={()=>void sendDueReminders()}>Send due reminders</Button>}</section>}
          {activeTab==="timesheets"&&canManagePeriods&&<div className="pt-3"><Button size="sm" variant="outline" onClick={()=>{setSettingsOpen(false);setCenterOpen(false);onManagePeriods?.()}}><CalendarClock className="size-4"/>Edit period dates and reminder days</Button></div>}
        </aside>}
      </section>
    </WindowSurface>}
    {popup&&inbox.notification&&!centerOpen&&(!inbox.notification.recipient_email||messagesOpen)&&<div role="status" className={`fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 border bg-white p-3 shadow-lg ${inbox.notification.recipient_email?"border-sky-200":"border-orange-300"}`}>{inbox.notification.recipient_email?<MessageSquare className="size-4 shrink-0 text-sky-700"/>:<Megaphone className="size-4 shrink-0 text-orange-700"/>}<div className="min-w-0"><p className="text-sm font-medium">{inbox.notification.recipient_email?(inbox.notification.priority==="high"?"High-priority message":"New message"):"New announcement"}</p><p className="truncate text-xs text-muted-foreground">{inbox.notification.sender_name||inbox.notification.author_name||"Organization"}</p></div><Button size="sm" variant="outline" onClick={openMessages}>Open Messages</Button><Button size="icon-sm" variant="ghost" title="Dismiss message notification" aria-label="Dismiss message notification" onClick={inbox.dismissNotification}><X className="size-4"/></Button></div>}
  </>
}

/** Formats message timestamps for the private notification list. @param value - ISO timestamp from the message API. @returns Local date and time, or a safe fallback. */
function formatNotificationDate(value:string):string{
  const date=new Date(value)
  return Number.isNaN(date.getTime())?"Time unavailable":new Intl.DateTimeFormat(undefined,{weekday:"long",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}).format(date)
}

function formatReminderSchedule(deadline:string,daysBefore:number,time:string,timezone:string):string{
  const date=new Date(deadline)
  if(Number.isNaN(date.getTime()))return "Date unavailable"
  try{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date)
    const values=Object.fromEntries(parts.map(part=>[part.type,part.value]))
    const localDate=new Date(Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)-daysBefore,12))
    const label=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(localDate)
    const [hour="00",minute="00"]=time.split(":")
    const clock=new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",hour12:true,timeZone:"UTC"}).format(new Date(Date.UTC(2020,0,1,Number(hour),Number(minute))))
    return `${label} · ${clock}`
  }catch{return "Check period timezone"}
}
