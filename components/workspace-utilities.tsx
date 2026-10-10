/**
 * Provides persistent messaging navigation outside primary dashboard controls.
 * Controls belong to the account header rather than a floating screen-edge rail.
 * Neutral icons and bounded unread badges preserve predictable tool sizing.
 */
"use client"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Renders the original chat-bubble control with a persistent unread counter.
 * @param props.unread - Server-backed unread message count.
 * @param props.onMessages - Opens messaging without replacing the workspace.
 * @returns JSX.Element containing persistent utility navigation.
 */
export function WorkspaceUtilities({unread,onMessages}:{unread:number;onMessages:()=>void}) {
  return <nav aria-label="Workspace utilities" className="flex shrink-0 items-center">
    <Button variant="ghost" size="icon-lg" aria-label={`Messages, ${unread} unread`} title="Messages" onClick={onMessages} className="relative text-foreground hover:bg-orange-50">
      <MessageSquare className="size-5" aria-hidden="true"/>
      <span aria-hidden="true" className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${unread>0?"bg-orange-600 text-white":"bg-zinc-200 text-zinc-700"}`}>{unread>99?"99+":unread}</span>
    </Button>
  </nav>
}
