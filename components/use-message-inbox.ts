/**
 * Keeps a scoped inbox current while the user navigates other application views.
 * Polling and focus refresh expose unread counts without marking messages read.
 * Initial inbox history never triggers a notification storm; only new IDs do.
 */
"use client"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { apiPath } from "@/lib/paths"
import type { AppMessage } from "@/lib/message-policy"
const EMPTY_MESSAGES:AppMessage[]=[]

/**
 * Loads messages and identifies newly received messages during this session.
 * @param enabled - Whether current account access allows inbox retrieval.
 * @returns Inbox state, unread count, notification, and a manual refresh callback.
 */
export function useMessageInbox(enabled = true) {
  const [messages, setMessages] = useState<AppMessage[]>([])
  const [email, setEmail] = useState("")
  const [admin, setAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [notification, setNotification] = useState<AppMessage | null>(null)
  const [older,setOlder]=useState<AppMessage[]>([])
  const [before,setBefore]=useState<{date:string;id:string}|null>(null)
  const [loadingOlder,setLoadingOlder]=useState(false)
  const olderPending=useRef(false)
  const hasOlder=useRef(false)
  const olderSnapshot=useRef(older);olderSnapshot.current=older
  const account=useRef("")
  const seen = useRef<Set<string> | null>(null)
  const newest = useRef(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!enabled) { setMessages([]);setOlder([]);setBefore(null);account.current="";hasOlder.current=false;setEmail("");setAdmin(false);setError(null);setNotification(null);setLoading(false);seen.current=null;newest.current=0;return }
    const controller = new AbortController()
    let fetching = false
    /**
     * Fetches the scoped inbox and announces only genuinely new incoming IDs.
     * @returns Promise<void> after message state or a safe error is updated.
     */
    async function load(): Promise<void> {
      if (fetching) return
      fetching = true
      try {
        const response = await fetch(apiPath("/api/messages"), {cache:"no-store",signal:controller.signal})
        const data = await response.json()
        if (!response.ok) {
          if(response.status===403){setMessages([]);setNotification(null);seen.current=null}
          throw new Error(data.error || "Inbox unavailable.")
        }
        if (controller.signal.aborted) return
        const identity = String(data.email ?? "").toLowerCase()
        if(account.current!==identity){account.current=identity;hasOlder.current=false;setOlder([]);setBefore(data.next??null)}
        else if(!hasOlder.current)setBefore(data.next??null)
        const next: AppMessage[] = data.messages
        if(olderSnapshot.current.length){
          const ids=olderSnapshot.current.map(message=>message.id),updated:AppMessage[]=[]
          for(let offset=0;offset<ids.length;offset+=100){
            const historical=await fetch(`${apiPath("/api/messages")}?ids=${encodeURIComponent(JSON.stringify(ids.slice(offset,offset+100)))}`,{cache:"no-store",signal:controller.signal})
            if(!historical.ok)throw new Error("History refresh unavailable.")
            updated.push(...(await historical.json()).messages)
          }
          if(!controller.signal.aborted)setOlder(updated)
        }
        const incoming = next.find(message => message.sender_email.toLowerCase() !== identity && !message.deleted_at && !message.read_at && !seen.current?.has(message.id) && Date.parse(message.created_at)>=newest.current)
        if (seen.current && incoming) setNotification(incoming)
        setNotification(previous=>previous&&next.some(message=>message.id===previous.id&&!message.read_at&&!message.deleted_at)?previous:null)
        seen.current = new Set([...(seen.current ?? []),...next.map(message => message.id)])
        newest.current=Math.max(newest.current,...next.map(message=>Date.parse(message.created_at)))
        setEmail(identity);setAdmin(data.role === "admin");setMessages(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);setError(null)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Inbox unavailable.") }
      finally { if (!controller.signal.aborted) setLoading(false);fetching=false }
    }
    void load()
    const timer = window.setInterval(()=>{if(document.visibilityState==="visible")void load()}, 10000)
    window.addEventListener("focus", load)
    return () => {controller.abort();window.clearInterval(timer);window.removeEventListener("focus",load)}
  }, [enabled, revision])
  /** @returns Promise<void> after an authorized older-history page is appended, without marking it read. */
  async function loadOlder():Promise<void>{
    if(!before||olderPending.current||!email)return
    olderPending.current=true;setLoadingOlder(true)
    const owner=account.current
    try{
      const response=await fetch(`${apiPath("/api/messages")}?before=${encodeURIComponent(JSON.stringify(before))}`,{cache:"no-store"})
      const data=await response.json();if(!response.ok)throw new Error(data.error)
      if(owner!==account.current)return
      hasOlder.current=true;setOlder(previous=>[...previous,...data.messages]);setBefore(data.next??null)
    }catch{setError("Older messages are unavailable. Try again.")}
    finally{olderPending.current=false;setLoadingOlder(false)}
  }
  const combined=useMemo(()=>[...new Map([...older,...messages].map(message=>[message.id,message])).values()].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)),[older,messages])
  const unread = messages.filter(message => !message.deleted_at && message.sender_email.toLowerCase() !== email && !message.read_at).length
  return {messages:enabled?combined:EMPTY_MESSAGES,email,admin,error,loading,unread,notification,dismissNotification:()=>setNotification(null),refresh,loadOlder,hasMore:!!before,loadingOlder}
}
export type MessageInbox = Omit<ReturnType<typeof useMessageInbox>,"loadOlder"|"hasMore"|"loadingOlder"> & Partial<Pick<ReturnType<typeof useMessageInbox>,"loadOlder"|"hasMore"|"loadingOlder">>
