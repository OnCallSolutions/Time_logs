/**
 * Displays account-level sent, delivered and read receipts with familiar tick icons.
 * Server acceptance is distinct from another account fetching or opening a message.
 * Device connectivity is never guessed from the sender's browser network state.
 */
import { Check, CheckCheck } from "lucide-react"
import type { AppMessage } from "@/lib/message-policy"
/**
 * Renders a truthful status for a server-confirmed outgoing message.
 * @param props.message - Receipt timestamps and aggregate broadcast counts.
 * @returns JSX.Element with an accessible status and matching color/icon.
 */
export function MessageReceipt({message}:{message:AppMessage}){
  const read=!!(message.read_at||message.read_count),delivered=!!(message.delivered_at||message.delivered_count)
  const status=read?"Read":delivered?"Delivered, unread":"Sent"
  return <span className="inline-flex items-center text-xs text-gray-600" aria-label={status} title={status}>
    {read?<CheckCheck aria-hidden="true" className="size-3 text-blue-600"/>:delivered?<CheckCheck aria-hidden="true" className="size-3 text-gray-500"/>:<Check aria-hidden="true" className="size-3 text-gray-500"/>}
  </span>
}
