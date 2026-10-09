/**
 * Provides persistent messaging navigation outside primary dashboard controls.
 * Desktop controls sit on the right; mobile controls sit at the bottom edge.
 * Neutral icons and bounded unread badges preserve predictable tool sizing.
 */
"use client"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Renders the responsive paper-plane messaging control.
 * @param props.unread - Server-backed unread message count.
 * @param props.onMessages - Opens messaging without replacing the workspace.
 * @returns JSX.Element containing persistent utility navigation.
 */
export function WorkspaceUtilities({unread,onMessages}:{unread:number;onMessages:()=>void}) {
  return <nav aria-label="Workspace utilities" className="fixed bottom-4 right-4 z-30 flex items-center border border-border bg-card p-2 shadow-sm md:bottom-auto md:right-3 md:top-1/2 md:-translate-y-1/2">
    <Button variant="ghost" size="icon-lg" aria-label={`Messages${unread?`, ${unread} unread`:""}`} title="Messages" onClick={onMessages} className="relative text-foreground hover:bg-muted">
      <Send className="size-5" aria-hidden="true"/>
      {unread>0&&<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread>99?"99+":unread}</span>}
    </Button>
  </nav>
}
