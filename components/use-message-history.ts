/**
 * Silently synchronizes account history among registered browser devices.
 * Transfers contain wrapped AES keys, not plaintext or exported private identities.
 * Paginated background scans are bounded per cycle and resume on the next poll.
 */
"use client"
import { useEffect, useRef, useState } from "react"
import { apiPath } from "@/lib/paths"
import { createHistoryShare, decryptHistoryMessage, type HistoryShare } from "@/lib/message-history-crypto"
import type { MessageIdentity, PublicMessageKey } from "@/lib/message-crypto"
import type { AppMessage } from "@/lib/message-policy"

/**
 * Relays encrypted history to newly enrolled devices and loads current-device shares.
 * @param email - Authenticated account owning every transfer endpoint.
 * @param identity - Current local nonextractable device identity, or null during setup.
 * @param keys - Server-authorized public directory including own devices.
 * @param revision - Poll counter scheduling retryable history continuation.
 * @returns Current-device history shares indexed by message UUID.
 */
export function useMessageHistory(email: string, identity: MessageIdentity | null, keys: PublicMessageKey[], revision: number) {
  const [shares, setShares] = useState<Record<string, HistoryShare>>({})
  const cursor = useRef<{ date: string; id: string } | null>(null)
  const scope = useRef("")
  const sent=useRef(new Set<string>())
  const ownKeySet = keys.filter(key => key.email === email).map(key => key.fingerprint).sort().join("|")
  useEffect(() => {
    if (!identity || !email) { setShares(previous=>Object.keys(previous).length?{}:previous); cursor.current = null; scope.current = "";sent.current.clear(); return }
    const currentScope = `${email}:${identity.fingerprint}:${ownKeySet}`
    if (scope.current !== currentScope) { scope.current = currentScope; cursor.current = null; setShares({});sent.current.clear() }
    const controller = new AbortController()
    /** @returns Promise<void> after bounded, resumable ciphertext-only history synchronization. */
    async function sync(): Promise<void> {
      try {
        for (let page = 0; page < 20 && !controller.signal.aborted; page++) {
          const params = new URLSearchParams({ device: identity!.fingerprint })
          if (cursor.current) params.set("before", JSON.stringify(cursor.current))
          const response = await fetch(`${apiPath("/api/messages/history")}?${params}`, { cache: "no-store", signal: controller.signal })
          if (!response.ok) return
          const data = await response.json() as { messages: AppMessage[]; shares: HistoryShare[]; next: { date: string; id: string } | null }
          if (!Array.isArray(data.messages) || !Array.isArray(data.shares)) return
          const received = Object.fromEntries(data.shares.map(share => [share.messageId, share]))
          if (!controller.signal.aborted) setShares(previous => ({ ...previous, ...received }))
          const transfers: HistoryShare[] = []
          const sentKeys:string[]=[]
          for (const message of data.messages) {
            const payload = message.encrypted_payload
            if (!payload || message.deleted_at) continue
            const authorFingerprint = payload.version === 2 ? payload.authorFingerprint : payload.keys[payload.author]?.fingerprint
            const author = keys.find(key => key.email === payload.author && key.fingerprint === authorFingerprint)
            if (!author) continue
            const native = payload.version === 2 ? !!payload.keys[email]?.devices?.[identity!.fingerprint] : payload.keys[email]?.fingerprint === identity!.fingerprint
            const priorShare=received[message.id],priorDevice=priorShare&&keys.find(key=>key.email===email&&key.fingerprint===priorShare.authorFingerprint)
            if(!native&&(!priorShare||!priorDevice))continue
            for (const target of keys.filter(key => key.email === email && key.fingerprint !== identity!.fingerprint && (payload.version === 2 ? !payload.keys[email]?.devices?.[key.fingerprint] : payload.keys[email]?.fingerprint !== key.fingerprint))) {
              if (controller.signal.aborted) return
              const transferKey=`${message.id}:${payload.signature}:${target.fingerprint}`
              if(sent.current.has(transferKey))continue
              transfers.push(await createHistoryShare(message.id, payload, identity!, email, author, target,native?undefined:{share:priorShare,device:priorDevice!}))
              sentKeys.push(transferKey)
              if (transfers.length === 50) {
                const saved = await fetch(apiPath("/api/messages/history"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shares: transfers.splice(0) }), signal: controller.signal })
                if (!saved.ok) return
                sentKeys.splice(0).forEach(key=>sent.current.add(key))
              }
            }
          }
          if (transfers.length) {
            const saved = await fetch(apiPath("/api/messages/history"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shares: transfers }), signal: controller.signal })
            if (!saved.ok) return
            sentKeys.forEach(key=>sent.current.add(key))
          }
          cursor.current = data.next
          if (!data.next) return
        }
      } catch { /* A later authenticated poll retries without requesting a user secret. */ }
    }
    void sync()
    return () => controller.abort()
  }, [email, identity, ownKeySet, revision, keys])
  return shares
}
