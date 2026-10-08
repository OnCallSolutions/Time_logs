/**
 * Keeps a scoped inbox current while the user navigates other application views.
 * Polling and focus refresh expose unread counts without marking messages read.
 * Initial inbox history never triggers a notification storm; only new IDs do.
 */
"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { apiPath } from "@/lib/paths"
import type { AppMessage } from "@/lib/message-policy"

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
  const seen = useRef<Set<string> | null>(null)
  const newest = useRef(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!enabled) { setMessages([]);setNotification(null);setLoading(false);seen.current=null;newest.current=0;return }
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
        const next: AppMessage[] = data.messages
        const incoming = next.find(message => message.sender_email.toLowerCase() !== identity && !message.deleted_at && !message.read_at && !seen.current?.has(message.id) && Date.parse(message.created_at)>=newest.current)
        if (seen.current && incoming) setNotification(incoming)
        setNotification(previous=>previous&&next.some(message=>message.id===previous.id&&!message.read_at&&!message.deleted_at)?previous:null)
        seen.current = new Set([...(seen.current ?? []),...next.map(message => message.id)])
        newest.current=Math.max(newest.current,...next.map(message=>Date.parse(message.created_at)))
        setEmail(identity);setAdmin(data.role === "admin");setMessages(next);setError(null)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Inbox unavailable.") }
      finally { if (!controller.signal.aborted) setLoading(false);fetching=false }
    }
    void load()
    const timer = window.setInterval(load, 10000)
    window.addEventListener("focus", load)
    return () => {controller.abort();window.clearInterval(timer);window.removeEventListener("focus",load)}
  }, [enabled, revision])
  const unread = messages.filter(message => !message.deleted_at && message.sender_email.toLowerCase() !== email && !message.read_at).length
  return {messages,email,admin,error,loading,unread,notification,dismissNotification:()=>setNotification(null),refresh}
}
export type MessageInbox = ReturnType<typeof useMessageInbox>
