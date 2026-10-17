/**
 * Provides compact message composition, receipts, editing, and confirmed deletion.
 * Read acknowledgments are sent only after incoming messages are explicitly opened.
 * Edit deadlines come from shared policy and are enforced again by the server.
 */
"use client"
import { Fragment, useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowUp, CheckCheck, ClipboardCopy, ClipboardPaste, LockKeyhole, MoreHorizontal, Pencil, RefreshCw, Save, Send, Trash2, X, Settings, Search, CalendarDays } from "lucide-react"
import { useMessageEncryption } from "@/components/use-message-encryption"
import { Button } from "@/components/ui/button"
import { WindowSurface } from "@/components/window-surface"
import { useMessageInbox, type MessageInbox } from "@/components/use-message-inbox"
import { apiPath } from "@/lib/paths"
import { audienceEmails,type MessageAudience } from "@/lib/message-audience"
import { canEditMessage, MESSAGE_EDIT_MINUTES, type AppMessage } from "@/lib/message-policy"
import { readClientData } from "@/lib/client-data-cache"
import { MessageAdminRecovery } from "./message-admin-recovery"
import { MessageReceipt } from "./message-receipt"

const messageBackgrounds = {
  sky: { label: "Sky", color: "bg-sky-200", canvas: "bg-sky-50", inbox: "bg-sky-50" },
  orange: { label: "Orange", color: "bg-orange-300", canvas: "bg-orange-50", inbox: "bg-orange-50" },
  green: { label: "Green", color: "bg-emerald-200", canvas: "bg-emerald-50", inbox: "bg-emerald-50" },
  violet: { label: "Violet", color: "bg-violet-200", canvas: "bg-violet-50", inbox: "bg-violet-50" },
  graphite: { label: "Graphite", color: "bg-slate-700", canvas: "bg-slate-200", inbox: "bg-slate-100" },
} as const
type MessageBackground = keyof typeof messageBackgrounds

/** @param value - Official display name. @returns Its first whitespace-delimited name. */
function officialFirstName(value?:string|null):string{return value?.trim().split(/\s+/)[0]||"Unknown sender"}

/** @param element - Scrollable thread canvas. @param top - Target vertical offset. @param behavior - Smooth or immediate scroll behavior. @returns void after moving the canvas when available. */
function scrollCanvas(element:HTMLElement|null,top:number,behavior:ScrollBehavior="smooth"):void{
  if(!element)return
  if(typeof element.scrollTo==="function")element.scrollTo({top,behavior})
  else element.scrollTop=top
}

/** @param value - Message timestamp. @param now - Current date used for relative labels. @returns A heading for a local calendar day. */
function messageDayHeading(value:string,now=new Date()):string{
  const date=new Date(value),day=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),days=Math.round((today-day)/86400000)
  if(days===0)return "Today"
  if(days===1)return "Yesterday"
  return new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric",...(date.getFullYear()!==now.getFullYear()?{year:"numeric"}:{})}).format(date)
}

/** @param value - Latest conversation activity. @param now - Current date used for relative labels. @returns Relative inbox section label. */
function inboxAgeHeading(value:string,now=new Date()):string{
  const date=new Date(value),start=(input:Date)=>new Date(input.getFullYear(),input.getMonth(),input.getDate()).getTime(),days=Math.round((start(now)-start(date))/86400000)
  if(days<=0)return "Today"
  if(days===1)return "Yesterday"
  if(days<7)return "Last week"
  if(days<31)return "Last month"
  return "Earlier"
}

/**
 * Displays a small circular profile image for an authorized message participant.
 * @param props.email - Participant whose image is requested through the scoped endpoint.
 * @param props.name - Official first name used for accessible fallback text.
 * @returns Circular participant image or a matching initial placeholder.
 */
function ParticipantAvatar({email,name}:{email:string;name:string}){
  const [failed,setFailed]=useState(false)
  return <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-orange-200 bg-orange-100 text-sm font-semibold text-orange-800">
    {!failed&&<img src={`${apiPath("/api/messages/avatar")}?email=${encodeURIComponent(email)}`} alt={`${name} profile photo`} className="size-full object-cover" onError={()=>setFailed(true)}/>}
    {failed&&name.charAt(0).toUpperCase()}
  </span>
}

/**
 * Renders inbox controls and message lifecycle actions for current permissions.
 * @param props.canSend - Whether the account may compose employee messages.
 * @param props.inbox - Optional shell-owned inbox for persistent notifications.
 * @returns JSX.Element containing the authorized message workspace.
 */
export function MessagesPanel({canSend,inbox,encryption:sharedEncryption,initialDraft,onDraftConsumed,onExplainMessage}:{canSend:boolean;inbox?:MessageInbox;encryption?:ReturnType<typeof useMessageEncryption>;initialDraft?:{recipient:string;body:string;confirmed?:boolean}|null;onDraftConsumed?:()=>void;onExplainMessage?:(text:string)=>void}) {
  const local = useMessageInbox(!inbox)
  const state = inbox ?? local
  const localEncryption=useMessageEncryption(sharedEncryption?"":state.email,state.messages)
  const encryption=sharedEncryption??localEncryption
  const [users,setUsers] = useState<{email:string;displayName?:string;role:string;accessStatus:string}[]>([])
  const [audience,setAudience]=useState<MessageAudience>("individual")
  const [rosterLoading,setRosterLoading]=useState(canSend)
  const [recipient,setRecipient] = useState("")
  const [body,setBody] = useState("")
  const [failed,setFailed] = useState<{body:string;recipient:string|null}|null>(null)
  const [error,setError] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const [editing,setEditing] = useState<AppMessage|null>(null)
  const [draft,setDraft] = useState("")
  const [deleting,setDeleting] = useState<{message:AppMessage;scope:"me"|"everyone"}|null>(null)
  const [composing,setComposing]=useState(false)
  const [identitiesOpen,setIdentitiesOpen]=useState(false)
  const [securityOpen,setSecurityOpen]=useState(false)
  const [messageBackground,setMessageBackground]=useState<MessageBackground>("sky")
  const [readReceiptsEnabled,setReadReceiptsEnabled]=useState(state.readReceiptsEnabled!==false)
  const [savingReceiptPreference,setSavingReceiptPreference]=useState(false)
  const [query,setQuery]=useState("")
  const [senderFilter,setSenderFilter]=useState("")
  const [actionMenuId,setActionMenuId]=useState<string|null>(null)
  const actionMenuRef=useRef<HTMLDivElement>(null)
  const [readIds,setReadIds] = useState<Set<string>>(new Set())
  const [selectedContact,setSelectedContact]=useState<string|null>(null)
  const [showAnnouncements,setShowAnnouncements]=useState(false)
  const [threadQuery,setThreadQuery]=useState("")
  const [dateToJump,setDateToJump]=useState("")
  const [dateNotice,setDateNotice]=useState("")
  const [clipboardNotice,setClipboardNotice]=useState("")
  const threadScroll=useRef<HTMLDivElement>(null)
  const replyInput=useRef<HTMLTextAreaElement>(null)
  const shouldFollowLatest=useRef(true)
  const activeThread=useRef<string|null>(null)
  const dateLoadAttempt=useRef(0)
  useEffect(()=>{
    if(!actionMenuId)return
    const closeOnOutsidePointer=(event:PointerEvent)=>{
      const target=event.target
      if(!(target instanceof Element))return
      if(target.closest('button[aria-label^="Message options for "]'))return
      if(!actionMenuRef.current?.contains(target))setActionMenuId(null)
    }
    const closeOnEscape=(event:KeyboardEvent)=>{
      if(event.key==="Escape")setActionMenuId(null)
    }
    document.addEventListener("pointerdown",closeOnOutsidePointer)
    document.addEventListener("keydown",closeOnEscape)
    return()=>{
      document.removeEventListener("pointerdown",closeOnOutsidePointer)
      document.removeEventListener("keydown",closeOnEscape)
    }
  },[actionMenuId])
  const loadOlderRef=useRef(state.loadOlder)
  loadOlderRef.current=state.loadOlder
  const ownEmail=state.email.toLowerCase()
  const peerEmail=(message:AppMessage)=>message.sender_email.toLowerCase()===ownEmail?message.recipient_email?.toLowerCase()??null:message.sender_email.toLowerCase()
  const firstName=officialFirstName
  const contactDirectory=new Map<string,{email:string;name:string;latest:AppMessage}>()
  for(const message of state.messages.filter(message=>message.recipient_email)){
    const email=peerEmail(message)!
    if(email===ownEmail)continue
    if(!contactDirectory.has(email)){
      const own=message.sender_email.toLowerCase()===ownEmail
      contactDirectory.set(email,{email,name:firstName(own?message.recipient_name:message.sender_name),latest:message})
    }
  }
  const contacts=[...contactDirectory.values()].sort((a,b)=>Date.parse(b.latest.created_at)-Date.parse(a.latest.created_at))
  const matchesContact=(contact:{email:string;name:string;latest:AppMessage})=>contact.name.toLowerCase().includes(query.trim().toLowerCase())||state.messages.some(message=>message.recipient_email&&peerEmail(message)===contact.email&&(message.encrypted_payload?encryption.plaintext[message.id]??"":message.body).toLowerCase().includes(query.trim().toLowerCase()))
  const unreadFor=(email:string)=>state.messages.filter(message=>message.recipient_email&&peerEmail(message)===email&&!message.deleted_at&&message.sender_email.toLowerCase()!==ownEmail&&!message.read_at&&!readIds.has(message.id)).length
  const announcementMessages=state.messages.filter(message=>!message.recipient_email)
  const matchesAnnouncements=announcementMessages.some(message=>`${firstName(message.sender_name)} ${message.encrypted_payload?encryption.plaintext[message.id]??"":message.body}`.toLowerCase().includes(query.trim().toLowerCase()))
  const announcementVisible=!senderFilter&&announcementMessages.length>0&&matchesAnnouncements
  const filteredContacts=contacts.filter(contact=>(!senderFilter||contact.email===senderFilter)&&matchesContact(contact))
  const contactSections=[...new Set(filteredContacts.map(contact=>inboxAgeHeading(contact.latest.created_at)))].map(label=>({label,contacts:filteredContacts.filter(contact=>inboxAgeHeading(contact.latest.created_at)===label)}))
  const threadMessages=state.messages.filter(message=>showAnnouncements?!message.recipient_email:!!selectedContact&&!!message.recipient_email&&peerEmail(message)===selectedContact)
    .filter(message=>{
      const text=message.encrypted_payload?encryption.plaintext[message.id]??"":message.body
      return `${firstName(message.sender_name)} ${message.deleted_at?"":text}`.toLowerCase().includes(threadQuery.trim().toLowerCase())
    }).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id))
  const threadTitle=showAnnouncements?"Announcements":contacts.find(contact=>contact.email===selectedContact)?.name??"Messages"
  const announcementUnread=announcementMessages.filter(message=>!message.deleted_at&&message.sender_email.toLowerCase()!==ownEmail&&!message.read_at&&!readIds.has(message.id)).length
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const selected=state.messages.find(message=>message.id===selectedId)
  const [now,setNow] = useState(Date.now())
  const canUnsend=(message:AppMessage,own:boolean)=>state.admin||(own&&canSend&&now<new Date(message.created_at).getTime()+MESSAGE_EDIT_MINUTES*60_000)
  const operation=useRef(false)
  const confirmedAssistantDraft=useRef<string|null>(null)
  useEffect(()=>{
    if(!state.email)return
    try{
      const saved=localStorage.getItem(`tanovo-message-background:${state.email.toLowerCase()}`)
      if(saved&&Object.hasOwn(messageBackgrounds,saved))setMessageBackground(saved as MessageBackground)
    }catch{/* Keep the default when browser storage is unavailable. */}
  },[state.email])
  useEffect(()=>setReadReceiptsEnabled(state.readReceiptsEnabled!==false),[state.readReceiptsEnabled])
  /** Persists this user's chosen conversation canvas on the current device. */
  function chooseMessageBackground(background:MessageBackground):void{
    setMessageBackground(background)
    try{localStorage.setItem(`tanovo-message-background:${state.email.toLowerCase()}`,background)}catch{/* The in-memory preference still applies for this visit. */}
  }
  async function chooseReadReceipts(enabled:boolean):Promise<void>{
    if(savingReceiptPreference)return
    setSavingReceiptPreference(true);setError(null)
    try{
      const response=await fetch(apiPath("/api/messages"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read_receipts",enabled})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||"Could not save read receipt preference.")
      setReadReceiptsEnabled(data.readReceiptsEnabled===true)
      state.refresh()
    }catch(error){setError(error instanceof Error?error.message:"Could not save read receipt preference.")}
    finally{setSavingReceiptPreference(false)}
  }
  const messageCanvasClass=messageBackgrounds[messageBackground].canvas
  const previousSend=useRef<{key:string;encrypted:Awaited<ReturnType<typeof encryption.encrypt>>}|null>(null)
  const missingRecipients=encryption.loaded&&encryption.unlocked
    ? audienceEmails(users,audience,recipient||null).filter(email=>!encryption.keys.some(key=>key.email.toLowerCase()===email.toLowerCase()))
    : []
  useEffect(() => {
    const timer = window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[])
  useEffect(()=>{
    if(!(selectedContact||showAnnouncements)||state.loading)return
    const threadKey=showAnnouncements?"announcements":selectedContact
    if(activeThread.current!==threadKey){activeThread.current=threadKey;shouldFollowLatest.current=true}
    if(shouldFollowLatest.current)requestAnimationFrame(()=>scrollCanvas(threadScroll.current,threadScroll.current?.scrollHeight??0,"auto"))
  },[selectedContact,showAnnouncements,state.loading,threadMessages.length])
  useEffect(()=>{
    if(!dateToJump||!selectedContact&&!showAnnouncements)return
    const dayMessages=threadMessages.filter(message=>{
      const date=new Date(message.created_at)
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`===dateToJump
    })
    if(dayMessages.length){
      const target=document.getElementById(`message-${dayMessages[0].id}`)
      target?.scrollIntoView?.({block:"start",behavior:"smooth"})
      setDateNotice(dayMessages.length===1?`Jumped to ${dateToJump}.`:`Showing ${dayMessages.length} messages from ${dateToJump}.`)
      setDateToJump("");return
    }
    if(state.hasMore&&!state.loadingOlder&&dateLoadAttempt.current!==state.messages.length){
      dateLoadAttempt.current=state.messages.length
      void loadOlderRef.current?.()
    }else if(!state.hasMore&&!state.loadingOlder){
      setDateNotice(`No messages found on or near ${dateToJump}.`);setDateToJump("")
    }
  },[dateToJump,selectedContact,showAnnouncements,threadMessages,state.messages.length,state.hasMore,state.loadingOlder])
  useEffect(()=>{
    if(!initialDraft)return
    setRecipient(initialDraft.recipient.toLowerCase());setBody(initialDraft.body);setAudience("individual");setComposing(true)
    confirmedAssistantDraft.current=initialDraft.confirmed?initialDraft.body:null
    onDraftConsumed?.()
  },[initialDraft,onDraftConsumed])
  useEffect(() => {
    if(!canSend||!state.email)return
    setRosterLoading(true)
    const controller=new AbortController()
    readClientData<{users:{email:string;displayName?:string;role:string;accessStatus:string}[]}>(apiPath("/api/delegation"),state.email,3000)
      .then(data=>{if(!controller.signal.aborted)setUsers(data.users.filter(user=>user.accessStatus==="active"))})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message)})
      .finally(()=>{if(!controller.signal.aborted)setRosterLoading(false)})
    return ()=>controller.abort()
  },[canSend,state.email])
  /**
   * Submits an explicit message mutation without optimistic success indicators.
   * @param method - HTTP method for sending, editing, or deleting.
   * @param payload - Validated action fields sent to the scoped API.
   * @returns Promise<boolean> indicating confirmed server success.
   */
  async function mutate(method:string,payload:object):Promise<boolean> {
    setBusy(true);setError(null)
    try {
      const response=await fetch(apiPath("/api/messages"),{method,signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
      const data=await response.json();if(!response.ok)throw new Error(data.error || "Message action failed.")
      state.refresh();return true
    } catch(error){
      if(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)){state.refresh();setError("The message request timed out. Its server outcome is unknown; refresh the conversation before retrying to avoid a duplicate.")}
      else setError(error instanceof Error?error.message:"Message action failed.")
      return false
    }
    finally{setBusy(false)}
  }
  /** @param message - Visible message selected from its action menu. @param scope - Personal hide or global unsend. @returns Promise<void> after confirmed deletion. */
  async function deleteMessage(message:AppMessage,scope:"me"|"everyone"):Promise<void>{
    const success=scope==="me"
      ? await mutate("PATCH",{action:"delete_for_me",id:message.id})
      : await mutate("DELETE",{id:message.id})
    if(success){setDeleting(null);setSelectedId(null);setActionMenuId(null)}
  }
  /**
   * Records an incoming message as read when opened in a visible browser tab.
   * @param message - Opened message; sender identities cannot acknowledge themselves.
   * @returns Promise<void> after receipt confirmation or a retryable error.
   */
  async function read(message:AppMessage):Promise<void> {
    if(document.visibilityState!=="visible" || (message.encrypted_payload&&!encryption.plaintext[message.id]) || message.deleted_at || message.read_at || readIds.has(message.id) || message.sender_email.toLowerCase()===state.email)return
    try {
      const response=await fetch(apiPath("/api/messages"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read",ids:[message.id]})})
      if(!response.ok)throw new Error("Unable to mark message read.")
      setReadIds(previous=>new Set([...previous,message.id]));state.refresh()
    }catch(error){setError(error instanceof Error?error.message:"Receipt unavailable.")}
  }
  /** @param messages - Messages in the thread explicitly opened by the account. @returns Promise<void> after visible incoming items are acknowledged. */
  async function readConversation(messages:AppMessage[]):Promise<void>{
    const ids=messages.filter(message=>message.sender_email.toLowerCase()!==ownEmail&&!message.deleted_at&&!message.read_at&&!readIds.has(message.id)).map(message=>message.id)
    if(!ids.length||document.visibilityState!=="visible")return
    try{
      const response=await fetch(apiPath("/api/messages"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read",ids})})
      if(!response.ok)throw new Error("Unable to mark messages read.")
      setReadIds(previous=>new Set([...previous,...ids]));state.refresh()
    }catch(error){setError(error instanceof Error?error.message:"Receipt unavailable.")}
  }
  /** Copies decrypted/plain message text to the local device clipboard. */
  async function copyMessage(text:string):Promise<void>{
    try{
      await navigator.clipboard.writeText(text)
      setClipboardNotice("Message copied to clipboard.")
    }catch{
      setError("Clipboard access is unavailable. Select the message text and copy it manually.")
    }
  }
  /** Pastes clipboard text at the current selection in the reply composer. */
  async function pasteIntoReply():Promise<void>{
    try{
      const pasted=await navigator.clipboard.readText()
      const input=replyInput.current
      const start=input?.selectionStart??body.length,end=input?.selectionEnd??body.length
      setBody(`${body.slice(0,start)}${pasted}${body.slice(end)}`)
      setClipboardNotice("Clipboard text added to the message.")
      requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+pasted.length,start+pasted.length)})
    }catch{
      setError("Clipboard access is unavailable. Use Ctrl+V or paste from your device menu.")
      replyInput.current?.focus()
    }
  }
  /** Marks one visible incoming message as read from its explicit action. */
  async function markMessageRead(message:AppMessage):Promise<void>{
    await read(message)
    setActionMenuId(null)
  }
  /** @param email - Authorized conversation participant. @returns A scoped same-origin avatar URL. */
  function avatarUrl(email:string):string{return `${apiPath("/api/messages/avatar")}?email=${encodeURIComponent(email)}`}
  /** @param message - Message being opened. @returns The counterpart's approved first name. */
  function messageLabel(message:AppMessage):string{
    return message.sender_email.toLowerCase()===ownEmail?"You":firstName(message.sender_name)
  }
  /** @param message - Message being opened. @returns The counterpart account email for avatar access. */
  function messagePeer(message:AppMessage):string|null{return peerEmail(message)}
  /** @returns Promise<void> after encrypting and sending the composed message. */
  async function send():Promise<void>{
    if(operation.current)return
    if(!canSend){setError("Your current rights do not allow sending messages.");return}
    if(rosterLoading){setError("Recipients are still loading. Please try again shortly.");return}
    if(!encryption.unlocked){setError("Secure messaging is connecting automatically. Wait a moment or use Retry connection.");return}
    if(!body.trim())return
    if(missingRecipients.length){setError(`Cannot send securely yet. Messaging setup is required for: ${missingRecipients.join(", ")}. No recipients were silently excluded.`);return}
    operation.current=true;setBusy(true);setError(null)
    try{
      const target=audience==="individual"?recipient:null
      const recipients=audienceEmails(users,audience,target)
      if(!recipients.length)throw new Error("Select an audience with active recipients.")
      const sendKey=JSON.stringify([state.email,target,audience,body,[...recipients].sort()])
      const encrypted=previousSend.current?.key===sendKey?previousSend.current.encrypted:await encryption.encrypt(body,target,[state.email,...recipients])
      previousSend.current={key:sendKey,encrypted}
      if(await mutate("POST",{recipient:target,audience,encrypted})){setFailed(null);setBody("");setComposing(false)}
      else setFailed({body,recipient:target})
    }catch(error){setFailed({body,recipient:audience==="individual"?recipient:null});setError(error instanceof Error?error.message:"Message connection unavailable.")}
    finally{operation.current=false;setBusy(false)}
  }
  useEffect(()=>{
    const confirmed=confirmedAssistantDraft.current
    if(!confirmed)return
    if(!canSend||body!==confirmed){confirmedAssistantDraft.current=null;return}
    if(rosterLoading||!encryption.loaded||!encryption.unlocked||missingRecipients.length)return
    confirmedAssistantDraft.current=null
    void send()
  },[body,canSend,encryption.loaded,encryption.unlocked,missingRecipients.length,rosterLoading])
  /** @returns Promise<void> after saving authenticated encrypted edits to the original participant set. */
  async function saveEdit():Promise<void>{
    if(!editing||operation.current)return
    operation.current=true;setBusy(true);setError(null)
    try{
      const payload=editing.encrypted_payload?{encrypted:await encryption.encrypt(draft,editing.recipient_email,Object.keys(editing.encrypted_payload.keys),editing.sender_email)}:{body:draft}
      if(await mutate("PATCH",{action:"edit",id:editing.id,...payload}))setEditing(null)
    }catch(error){setError(error instanceof Error?error.message:"Unable to encrypt edit.")}
    finally{operation.current=false;setBusy(false)}
  }
  return <section aria-label="Messages" className="space-y-3">
    <div className="flex items-center justify-between gap-2 border-b pb-3"><h2 className="text-base font-semibold">Messages <span className="text-xs text-muted-foreground">{state.unread ? `${state.unread} unread` : ""}</span></h2><div className="flex gap-2"><Button size="icon-sm" variant="ghost" title="Message settings" aria-label="Message settings" onClick={()=>setSecurityOpen(true)}><Settings className="size-4"/></Button><Button size="icon-sm" variant="ghost" title="Refresh inbox" aria-label="Refresh inbox" onClick={state.refresh}><RefreshCw className="size-4"/></Button></div></div>
    {(error||state.error)&&<p role="alert" className="text-sm text-destructive">{error||state.error}</p>}
    {!encryption.unlocked&&!encryption.error&&<p role="status" className="text-sm text-muted-foreground">Connecting secure messaging automatically...</p>}
    {state.loading&&<p role="status" className="text-sm text-muted-foreground">Loading messages...</p>}
    {encryption.error&&<Button size="sm" variant="outline" onClick={()=>encryption.retry?.()}>Retry connection</Button>}
    {encryption.error&&<p role="alert" className="text-sm text-destructive">{state.admin?encryption.error:"Message connection unavailable. Retry or contact an administrator."}</p>}
    {securityOpen&&<WindowSurface title="Message settings" onBack={()=>setSecurityOpen(false)} disabled={encryption.busy}><div className="w-full max-w-xl overflow-auto p-4">
      <section className="mb-4 flex items-start justify-between gap-4 border-b pb-4"><div><h2 className="font-semibold">Read receipts</h2><p className="mt-1 max-w-md text-xs text-muted-foreground">When off, people who message you will not see when you have read their messages. Your own unread counts still work.</p></div><label className="flex shrink-0 items-center gap-2 text-sm font-medium"><input aria-label="Send read receipts" type="checkbox" checked={readReceiptsEnabled} disabled={savingReceiptPreference} onChange={event=>void chooseReadReceipts(event.target.checked)} className="size-4 accent-blue-600"/>{readReceiptsEnabled?"On":"Off"}</label></section>
      <section className="mb-4 border-b pb-4"><h2 className="font-semibold">Message appearance</h2><p className="my-2 text-xs text-muted-foreground">Choose a conversation background for this account on this device.</p><div role="group" aria-label="Message background" className="flex flex-wrap gap-2">{(Object.entries(messageBackgrounds) as [MessageBackground,typeof messageBackgrounds[MessageBackground]][]).map(([key,theme])=><Button key={key} type="button" variant="outline" size="sm" aria-label={`${theme.label} message background`} aria-pressed={messageBackground===key} onClick={()=>chooseMessageBackground(key)} className={messageBackground===key?"border-orange-500 ring-2 ring-orange-200":""}><span aria-hidden="true" className={`size-4 rounded-full border border-black/10 ${theme.color}`}/>{theme.label}</Button>)}</div></section>
      {state.admin?<div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary"/>{encryption.unlocked?"End-to-end encryption connected":"Secure messaging is connecting"}</p></div>:<p className="text-sm">{encryption.unlocked?"Messages connected":"Messages connecting"}</p>}
      {encryption.error&&<p role="alert" className="mt-2 text-sm text-destructive">{state.admin?encryption.error:"Message connection unavailable. Retry or contact an administrator."}</p>}
      {state.admin&&<><p className="mt-3 text-xs text-muted-foreground">Device identities connect automatically. History sync requires an existing trusted device or configured organization recovery.</p><Button variant="ghost" size="sm" className="mt-2" onClick={()=>setIdentitiesOpen(true)}><LockKeyhole className="size-3"/>Device identities</Button></>}
      {error&&<p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div></WindowSurface>}
    {!selectedContact&&!showAnnouncements&&<>
      <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-0 flex-1"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground"/><input aria-label="Search messages" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search people and messages" className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"/></label><label className="sr-only" htmlFor="message-sender-filter">Filter by sender</label><select id="message-sender-filter" aria-label="Filter by sender" value={senderFilter} onChange={event=>setSenderFilter(event.target.value)} className="max-w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="">All senders</option>{contacts.map(contact=><option key={contact.email} value={contact.email}>{contact.name}</option>)}</select>{canSend&&<Button variant="outline" size="sm" onClick={()=>setComposing(true)}><Pencil className="size-3"/>New message</Button>}</div>
      <div aria-label="Message inbox" className={`max-h-[68dvh] min-h-48 overflow-auto overscroll-contain rounded-md border ${messageBackgrounds[messageBackground].inbox}`}>
        <div className="space-y-1.5 p-2">
        {announcementVisible&&<button type="button" onClick={()=>{setShowAnnouncements(true);setThreadQuery("");setDateNotice("");setClipboardNotice("")}} className="flex w-full items-center gap-2.5 rounded-md border border-orange-300 bg-orange-50 px-2.5 py-2 text-left shadow-sm transition-colors hover:border-orange-400 hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">A</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="text-sm">Announcements</strong><time className="shrink-0 text-xs text-muted-foreground">{new Date(announcementMessages[0].created_at).toLocaleString()}</time></span><span className="block truncate text-sm text-muted-foreground">{announcementMessages[0].deleted_at?"Message deleted":announcementMessages[0].encrypted_payload?encryption.plaintext[announcementMessages[0].id]??"Encrypted announcement":announcementMessages[0].body}</span></span>{announcementUnread>0&&<span aria-label={`${announcementUnread} unread`} className="ml-auto shrink-0 rounded-full bg-orange-600 px-2 py-0.5 text-xs font-semibold text-white">{announcementUnread}</span>}
        </button>}
        {contactSections.map(section=><section key={section.label} aria-label={`${section.label} conversations`}><h3 className="sticky top-0 z-[1] mb-1 border-b border-orange-200 bg-orange-100/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-orange-900">{section.label}</h3><div className="space-y-1">{section.contacts.map(contact=>{
          const latest=contact.latest,preview=latest.deleted_at?"Message deleted":latest.encrypted_payload?encryption.plaintext[latest.id]??"Encrypted message":latest.body
          const unread=unreadFor(contact.email)
          return <button key={contact.email} type="button" aria-label={`${contact.name}${unread?`, ${unread} unread`:""}, latest message: ${preview}`} onClick={()=>{setSelectedContact(contact.email);setAudience("individual");setRecipient(contact.email);setThreadQuery("");setDateNotice("");setDateToJump("");setClipboardNotice("")}} className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${unread?"border-orange-300 bg-white hover:border-orange-400 hover:bg-orange-50":"border-sky-200 bg-white/90 hover:border-sky-400 hover:bg-sky-50"}`}>
            <ParticipantAvatar email={contact.email} name={contact.name}/><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{contact.name}</strong><time className="shrink-0 text-xs text-muted-foreground">{new Date(latest.created_at).toLocaleString()}</time></span><span className="block truncate text-sm text-muted-foreground">{latest.sender_email.toLowerCase()===ownEmail?"You: ":""}{preview}</span></span>{unread>0&&<span aria-label={`${unread} unread`} className="ml-auto shrink-0 rounded-full bg-orange-600 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span>}
          </button>
        })}</div></section>)}
        {!state.loading&&!contacts.length&&!announcementMessages.length&&<p className="p-5 text-center text-sm text-muted-foreground">No messages yet.</p>}
        {!state.loading&&contacts.length+announcementMessages.length>0&&!filteredContacts.length&&!announcementVisible&&<p className="p-5 text-center text-sm text-muted-foreground">No matching conversations.</p>}
        </div>
      </div>
      {state.admin&&<MessageAdminRecovery/>}
    </>}
    {(selectedContact||showAnnouncements)&&<section aria-label={`${threadTitle} conversation`} className="flex min-h-0 h-[min(72dvh,58rem)] flex-col overflow-hidden rounded-md border bg-white">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-orange-200 bg-orange-50 p-3">
        <Button variant="ghost" size="icon-sm" aria-label="Back to message inbox" title="Back to inbox" onClick={()=>{setSelectedContact(null);setShowAnnouncements(false);setThreadQuery("");setDateNotice("");activeThread.current=null}}><ArrowLeft className="size-4"/></Button>
        {selectedContact&&<ParticipantAvatar email={selectedContact} name={threadTitle}/>}
        {showAnnouncements&&<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-500 font-semibold text-white">A</span>}
        <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{threadTitle}</h3><p className="text-xs text-muted-foreground">{showAnnouncements?"Announcements":"Message thread"}</p></div>
        <label className="relative min-w-40 flex-1"><Search aria-hidden="true" className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><input aria-label="Search conversation" value={threadQuery} onChange={event=>setThreadQuery(event.target.value)} placeholder="Search this conversation" className="w-full rounded-md border bg-white py-2 pl-9 pr-2 text-sm"/></label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Jump to a date"><CalendarDays className="size-4"/><input aria-label="Scroll to date" type="date" value={dateToJump} onChange={event=>{dateLoadAttempt.current=0;setThreadQuery("");setDateNotice("");setDateToJump(event.target.value)}} className="w-32 rounded-md border bg-white p-1.5 text-xs"/></label>
        <Button variant="outline" size="sm" title="Scroll to top" aria-label="Scroll to top" onClick={()=>scrollCanvas(threadScroll.current,0)}><ArrowUp className="size-4"/>Top</Button>
        <Button variant="outline" size="sm" title="Scroll to bottom" aria-label="Scroll to bottom" onClick={()=>{shouldFollowLatest.current=true;scrollCanvas(threadScroll.current,threadScroll.current?.scrollHeight??0)}}><ArrowDown className="size-4"/>Latest</Button>
      </header>
      {threadMessages.some(message=>message.sender_email.toLowerCase()!==ownEmail&&!message.deleted_at&&!message.read_at&&!readIds.has(message.id))&&<div className="flex shrink-0 justify-end border-b border-blue-200 bg-blue-50 px-3 py-1"><Button variant="ghost" size="sm" className="text-blue-800 hover:bg-blue-100" onClick={()=>void readConversation(threadMessages)}><CheckCheck className="size-4"/>Mark conversation as read</Button></div>}
      {dateNotice&&<p role="status" className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">{dateNotice}</p>}
      {state.hasMore&&<div className="flex shrink-0 justify-center border-b p-2"><Button variant="ghost" size="sm" disabled={state.loadingOlder} onClick={()=>void state.loadOlder?.()}>{state.loadingOlder?"Loading older messages...":"Load older messages"}</Button></div>}
      <div ref={threadScroll} onScroll={event=>{const element=event.currentTarget;shouldFollowLatest.current=element.scrollHeight-element.scrollTop-element.clientHeight<120}} aria-label="Message history" className={`min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain ${messageCanvasClass} p-3 sm:p-5`}>
        {!threadMessages.length&&<p className="py-8 text-center text-sm text-muted-foreground">{threadQuery?"No messages match your search.":"No messages in this conversation yet."}</p>}
        {threadMessages.map((message,index)=>{
          const own=message.sender_email.toLowerCase()===ownEmail
          const text=message.encrypted_payload?encryption.plaintext[message.id]??"Message history is syncing...":message.body
          const editable=(canSend||state.admin)&&(!message.encrypted_payload||!!encryption.plaintext[message.id])&&canEditMessage(message,state.email,state.admin,now)
          const peer=messagePeer(message)
          const label=messageLabel(message)
          const dayHeading=messageDayHeading(message.created_at),previousHeading=index?messageDayHeading(threadMessages[index-1].created_at):null
          return <Fragment key={message.id}>{dayHeading!==previousHeading&&<div role="separator" aria-label={dayHeading} className="sticky top-1 z-[1] mx-auto w-fit rounded-full border border-orange-200 bg-white/95 px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm">{dayHeading}</div>}<article id={`message-${message.id}`} className={`flex w-full items-end gap-2 ${own?"justify-end":"justify-start"}`}>
            {!own&&peer&&<ParticipantAvatar email={peer} name={label}/>}
            <div className={`max-w-[min(88%,42rem)] min-w-36 rounded-lg border px-3 py-2 shadow-sm ${own?"border-green-300 bg-green-100":"border-orange-300 bg-orange-100"}`}>
              <button type="button" className="block w-full text-left [overflow-wrap:anywhere]" onClick={()=>{setSelectedId(message.id);void read(message)}}>
                <span className="block text-xs font-semibold text-neutral-700">{label}</span>
                {message.priority==="high"&&<span className="mt-1 block text-xs font-bold text-red-700">High priority</span>}
                <span className="my-1 block whitespace-pre-wrap break-words text-sm">{message.deleted_at?"Message deleted":text}</span>
                <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1"><time className="text-[11px] text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time>{message.edited_at&&!message.deleted_at&&<span className="text-[11px] text-muted-foreground">Edited</span>}{own&&!message.deleted_at&&<MessageReceipt message={message}/>}</span>
                {!own&&!message.read_at&&!readIds.has(message.id)&&!message.deleted_at&&<span className="sr-only">Unread message</span>}
              </button>
            </div>
            <div className="relative shrink-0 self-center"><Button variant="ghost" size="icon-sm" title="Message options" aria-label={`Message options for ${label}`} aria-expanded={actionMenuId===message.id} onClick={()=>setActionMenuId(actionMenuId===message.id?null:message.id)}><MoreHorizontal className="size-4"/></Button>{actionMenuId===message.id&&<div ref={actionMenuRef} role="menu" aria-label={`Actions for ${label}'s message`} className="absolute right-0 top-full z-20 grid min-w-48 gap-1 rounded-md border bg-white p-1.5 text-sm shadow-lg" onClick={()=>setActionMenuId(null)}>{editable&&<button role="menuitem" type="button" className="rounded px-3 py-2 text-left hover:bg-orange-50" onClick={()=>{setEditing(message);setDraft(text)}}><Pencil className="mr-2 inline size-3.5"/>Edit message</button>}{!message.deleted_at&&(!message.encrypted_payload||!!encryption.plaintext[message.id])&&<button role="menuitem" type="button" className="rounded px-3 py-2 text-left hover:bg-blue-50" onClick={()=>void copyMessage(text)}><ClipboardCopy className="mr-2 inline size-3.5"/>Copy message</button>}{!own&&!message.deleted_at&&!message.read_at&&!readIds.has(message.id)&&<button role="menuitem" type="button" className="rounded px-3 py-2 text-left text-blue-800 hover:bg-blue-50" onClick={()=>void markMessageRead(message)}><CheckCheck className="mr-2 inline size-3.5"/>Mark as read</button>}<button role="menuitem" type="button" className="rounded px-3 py-2 text-left hover:bg-orange-50" onClick={()=>setDeleting({message,scope:"me"})}><Trash2 className="mr-2 inline size-3.5"/>Delete for me</button>{canUnsend(message,own)&&!message.deleted_at&&<button role="menuitem" type="button" className="rounded px-3 py-2 text-left text-red-700 hover:bg-red-50" onClick={()=>setDeleting({message,scope:"everyone"})}><Trash2 className="mr-2 inline size-3.5"/>Delete for everyone</button>}</div>}</div>
            {selected?.id===message.id&&<WindowSurface title="Message detail" onBack={()=>setSelectedId(null)}><section className="flex min-h-0 w-full max-w-4xl flex-col bg-white"><header className="border-b p-4"><h2 className="font-semibold">Message detail</h2><p className="text-sm text-muted-foreground">{messageLabel(message)}</p></header><div className="min-h-0 flex-1 overflow-auto p-4">{message.priority==="high"&&<p className="mb-1 text-xs font-bold text-red-700">High priority</p>}<p className="whitespace-pre-wrap break-words text-sm">{message.deleted_at?"Message deleted":text}</p>
              {!message.deleted_at&&<div className="mt-4 flex flex-wrap gap-2">{onExplainMessage&&(!message.encrypted_payload||!!encryption.plaintext[message.id])&&<Button variant="outline" size="sm" onClick={()=>onExplainMessage(`Sender: ${message.sender_name||"Unknown sender"}; recipient: ${message.recipient_name||"All recipients"}; sent: ${new Date(message.created_at).toISOString()}\n\n${text}`)}><Search className="size-3"/>Explain with AI</Button>}{editable&&<Button variant="outline" size="sm" onClick={()=>{setEditing(message);setDraft(text)}}><Pencil className="size-3"/>Edit message</Button>}{own&&!state.admin&&!editable&&<p className="text-xs text-muted-foreground">Editing closed after {MESSAGE_EDIT_MINUTES} minutes.</p>}</div>}
            </div></section></WindowSurface>}
          </article></Fragment>
        })}
      </div>
      {selectedContact&&canSend&&<form aria-label="Reply composer" onSubmit={event=>{event.preventDefault();void send()}} className="flex shrink-0 items-end gap-2 border-t border-orange-200 bg-white p-3">
        <textarea ref={replyInput} aria-label={`Message ${threadTitle}`} value={body} disabled={busy} maxLength={4000} rows={2} onChange={event=>setBody(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();void send()}}} placeholder={`Message ${threadTitle}...`} className="min-h-12 max-h-32 min-w-0 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"/>
        <Button type="button" variant="outline" size="icon" title="Paste from clipboard" aria-label="Paste from clipboard" disabled={busy} onClick={()=>void pasteIntoReply()}><ClipboardPaste className="size-4"/></Button>
        <Button type="submit" size="icon" title="Send message" aria-label="Send reply" disabled={busy||!body.trim()||!encryption.unlocked}><Send className="size-4"/></Button>
      </form>}
      {clipboardNotice&&<p role="status" className="sr-only">{clipboardNotice}</p>}
    </section>}
    {composing&&<WindowSurface title="New message" onBack={()=>setComposing(false)} disabled={busy}><section className="flex min-h-0 w-full max-w-4xl flex-col bg-white"><h2 className="border-b p-4 font-semibold">New message</h2><div className="grid min-h-0 flex-1 content-start gap-3 overflow-auto p-4">
      {!encryption.unlocked&&!encryption.error&&<p role="status" className="text-sm text-muted-foreground">Connecting secure messaging automatically...</p>}
      {encryption.error&&<p role="alert" className="text-sm text-destructive">{state.admin?encryption.error:"Message connection unavailable. Retry or contact an administrator."}</p>}
      {rosterLoading&&<p role="status" className="text-sm text-muted-foreground">Loading recipients...</p>}
      {missingRecipients.length>0&&<p role="status" className="text-sm text-muted-foreground">These recipients need to sign in once so their devices connect automatically: {missingRecipients.join(", ")}.</p>}
      <label className="text-sm">Audience<select value={audience} disabled={busy} onChange={event=>{setAudience(event.target.value as MessageAudience);setRecipient("")}} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="workforce">Employees and contractors announcement</option><option value="everyone">Everyone announcement</option><option value="contractor">All contractors announcement</option><option value="employee">All employees announcement</option><option value="manager">All managers announcement</option><option value="admin">All admins announcement</option><option value="individual">Individual message</option></select></label>
      {audience==="individual"&&<label className="text-sm">Recipient<select value={recipient} disabled={busy} onChange={event=>setRecipient(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="">Choose a person</option>{users.map(user=><option key={user.email} value={user.email}>{user.displayName||"Unknown sender"}</option>)}</select></label>}
      <label className="text-sm">Message<textarea ref={replyInput} value={body} disabled={busy} maxLength={4000} onChange={event=>setBody(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border border-border bg-background p-2"/></label>
      <Button type="button" variant="outline" size="sm" className="w-fit" disabled={busy} onClick={()=>void pasteIntoReply()}><ClipboardPaste className="size-4"/>Paste from clipboard</Button>
      {audience==="individual"&&!recipient&&<p className="text-sm text-muted-foreground">Choose a recipient before sending.</p>}
      <Button className="w-fit" disabled={busy||rosterLoading||!body.trim()||!encryption.unlocked||!canSend||(audience==="individual"&&!recipient)} onClick={send}><Send className="size-4"/>{busy?"Sending...":"Send message"}</Button>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    </div></section></WindowSurface>}
    {identitiesOpen&&<WindowSurface title="Encryption identities" onBack={()=>setIdentitiesOpen(false)}><section className="w-full overflow-auto bg-white p-4"><h2 className="font-semibold">Encryption identities</h2><p className="my-3 text-sm text-muted-foreground">Compare fingerprints with participants using another trusted channel.</p><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Actor</th><th className="p-2">Fingerprint</th></tr></thead><tbody>{encryption.keys.map(key=><tr key={`${key.email}:${key.fingerprint}`} className="border-b"><td className="p-2">{key.email}</td><td className="break-all p-2 font-mono text-xs">{key.fingerprint}</td></tr>)}</tbody></table></section></WindowSurface>}
    {failed&&<article aria-label="Unconfirmed outgoing message" className="ml-auto w-fit max-w-[88%] rounded-md border border-red-300 bg-red-100 p-3 text-sm sm:max-w-[36rem]"><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{failed.body}</p><p className="mt-2 text-xs text-red-700"><strong aria-label="Unsent message">!!</strong> Send not confirmed. Refresh before retrying.</p><Button variant="ghost" size="sm" onClick={()=>{setBody(failed.body);setRecipient(failed.recipient??"");setComposing(true)}}>Review unsent message</Button></article>}
    {editing&&<WindowSurface title="Edit message" onBack={()=>setEditing(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-3xl flex-col bg-white">
      <h2 className="border-b p-4 font-semibold">Edit message</h2><div className="min-h-0 flex-1 overflow-auto p-4"><label className="text-sm">Message<textarea className="mt-2 min-h-40 w-full rounded-md border p-3" value={draft} maxLength={4000} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      <div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setEditing(null)}><X className="size-4"/>Cancel</Button><Button disabled={busy||!draft.trim()||!canEditMessage(editing,state.email,state.admin,now)} onClick={saveEdit}><Save className="size-4"/>{busy?"Saving...":"Save message"}</Button></div>
    </section></WindowSurface>}
    {deleting&&<WindowSurface title={deleting.scope==="me"?"Delete for me":"Delete for everyone"} onBack={()=>setDeleting(null)} disabled={busy}><section className="flex min-h-0 w-full max-w-xl flex-col bg-white"><h2 className="border-b p-4 font-semibold">{deleting.scope==="me"?"Remove from your inbox":"Unsend for everyone"}</h2><div className="min-h-0 flex-1 overflow-auto p-4"><p className="text-sm">{deleting.scope==="me"?"This message will disappear from your inbox only. Other participants will still see it.":"This replaces the message with a deletion marker for all participants. The sender can unsend within one hour."}</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div><div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={()=>void deleteMessage(deleting.message,deleting.scope)}><Trash2 className="size-4"/>{busy?"Deleting...":deleting.scope==="me"?"Delete for me":"Delete for everyone"}</Button></div></section></WindowSurface>}
  </section>
}
