/**
 * Provides isolated application windows with consistent full-screen navigation.
 * Portals keep nested windows outside hidden parent surfaces. Background windows
 * remain mounted so Back restores their drafts, selection, and scroll position.
 */
"use client"
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, Maximize2, Minimize2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDialogFocus } from "@/components/use-dialog-focus"
import { useWindowAssistantRenderer } from "@/components/window-assistant-context"

const windows: HTMLElement[] = []
const background = new Map<HTMLElement, { inert: boolean; visibility: string }>()

/**
 * Reconciles visibility after opening or removing any member of the window stack.
 * @returns void; restores original background state when the stack is empty.
 */
function reconcileWindows(): void {
  const active = windows.at(-1)
  for (const [element, original] of background) {
    element.inert = active && element !== active ? true : original.inert
    element.style.visibility = active && element !== active ? "hidden" : original.visibility
  }
  if (!active) background.clear()
}

/**
 * Isolates the active window and restores the previous surface on dismissal.
 * @param props.title - Accessible window name.
 * @param props.onBack - Callback returning to the immediate previous window.
 * @param props.disabled - Prevents dismissal while a save is pending.
 * @param props.compact - Allows restoring the window to a centered, bounded size after opening full-screen.
 * @param props.resizable - Allows restored compact windows to be resized by dragging any edge or corner.
 * @param props.children - Existing window content and workflow controls.
 * @param props.sessionGuard - Marks the privileged privacy shield during session verification.
 * @returns React portal containing the active application window.
 */
export function WindowSurface({ title, onBack, disabled = false, children,sessionGuard=false,compact=true,resizable=true,assistant=true }: {
  title: string; onBack: () => void; disabled?: boolean; children: ReactNode;sessionGuard?:boolean;compact?:boolean;resizable?:boolean;assistant?:boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [assistantOpen,setAssistantOpen]=useState(false)
  const [mounted, setMounted] = useState(false)
  const resizeTarget = useRef<HTMLDivElement>(null)
  const resizeStart = useRef<{ pointerId: number; edge: string; x: number; y: number; width: number; height: number; left: number; top: number } | null>(null)
  const ref = useDialogFocus<HTMLDivElement>(onBack, !disabled, mounted)
  const renderAssistant=useWindowAssistantRenderer()
  const assistantWorkspace=title.normalize("NFKD").replace(/[^a-zA-Z0-9_.-]+/g,"_").slice(0,100)||"workspace"
  useEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    if (!mounted || !ref.current) return
    const window = ref.current
    for (const element of Array.from(document.body.children)) {
      if (element instanceof HTMLElement && !background.has(element)) {
        background.set(element, { inert: !!element.inert, visibility: element.style.visibility })
      }
    }
    windows.push(window)
    reconcileWindows()
    return () => {
      windows.splice(windows.indexOf(window), 1)
      reconcileWindows()
    }
  }, [mounted, ref])
  if (!mounted) return null
  const compactView = compact && !expanded
  /** Starts edge or corner dragging of the complete compact window. */
  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    const target = resizeTarget.current
    if (!target) return
    const bounds = target.getBoundingClientRect()
    resizeStart.current = { pointerId: event.pointerId, edge: event.currentTarget.dataset.resizeEdge ?? "se", x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, left: 0, top: 0 }
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
  }
  /** Applies bounded width and height changes while dragging a window edge. */
  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const start = resizeStart.current
    const target = resizeTarget.current
    if (!start || !target || start.pointerId !== event.pointerId) return
    const maxWidth = Math.max(1, window.innerWidth - 32)
    const maxHeight = Math.max(1, window.innerHeight - 32)
    const minWidth = Math.min(280, maxWidth)
    const minHeight = Math.min(240, maxHeight)
    const horizontalDelta = start.edge.includes("e") ? event.clientX - start.x : start.edge.includes("w") ? start.x - event.clientX : 0
    const verticalDelta = start.edge.includes("s") ? event.clientY - start.y : start.edge.includes("n") ? start.y - event.clientY : 0
    const width = Math.min(maxWidth, Math.max(minWidth, start.width + horizontalDelta))
    const height = Math.min(maxHeight, Math.max(minHeight, start.height + verticalDelta))
    const widthChange = width - start.width
    const heightChange = height - start.height
    const left = start.edge.includes("e") ? widthChange / 2 : start.edge.includes("w") ? -widthChange / 2 : 0
    const top = start.edge.includes("s") ? heightChange / 2 : start.edge.includes("n") ? -heightChange / 2 : 0
    target.style.width = `${width}px`
    target.style.height = `${height}px`
    target.style.left = `calc(50% + ${left}px)`
    target.style.top = `calc(50% + ${top}px)`
  }
  /** Ends the current pointer resize gesture. */
  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizeStart.current?.pointerId === event.pointerId) resizeStart.current = null
  }
  const resizeEdges = [
    ["n", "inset-x-3 top-0 h-2 cursor-ns-resize"], ["s", "inset-x-3 bottom-0 h-2 cursor-ns-resize"],
    ["e", "inset-y-3 right-0 w-2 cursor-ew-resize"], ["w", "inset-y-3 left-0 w-2 cursor-ew-resize"],
    ["ne", "right-0 top-0 size-3 cursor-nesw-resize"], ["nw", "left-0 top-0 size-3 cursor-nwse-resize"],
    ["se", "bottom-0 right-0 size-3 cursor-nwse-resize"], ["sw", "bottom-0 left-0 size-3 cursor-nesw-resize"],
  ] as const
  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      data-window-expanded={expanded}
      data-window-resizable={compact && resizable ? "true" : undefined}
      data-session-guard={sessionGuard?"true":undefined}
      className={`window-surface tech-surface fixed inset-0 z-[70] flex min-h-0 ${compactView ? "items-center justify-center bg-black/45 p-4" : "flex-col bg-background p-0"}`}>
      <div ref={resizeTarget} className={`relative flex min-h-0 flex-col overflow-hidden ${compactView ? resizable ? "absolute left-1/2 top-1/2 h-[min(82dvh,48rem)] w-[min(92vw,58rem)] min-h-[min(20rem,calc(100dvh-2rem))] min-w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-2xl" : "max-h-[min(80dvh,40rem)] w-full max-w-lg rounded-lg border border-border bg-background shadow-2xl" : "h-full w-full"}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-orange-400 bg-gradient-to-r from-orange-50 via-sky-50 to-emerald-50 px-3 py-2">
          <Button variant="outline" size="sm" disabled={disabled} onClick={onBack} className="border-orange-200 bg-white/80 text-slate-800 hover:bg-orange-100"><ArrowLeft className="size-4" />Back</Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" title={expanded ? "Restore window" : "Expand window"}
              aria-label={expanded ? "Restore window" : "Expand window"} onClick={() => setExpanded(value => !value)} className="border-sky-200 bg-white/80 text-sky-900 hover:bg-sky-100">
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          </div>
        </div>
        <div className="window-content flex min-h-0 flex-1 justify-center overflow-hidden">{children}</div>
        {assistant&&renderAssistant&&<div className="absolute bottom-4 right-4 z-30">
          {assistantOpen?<div className="h-[min(68dvh,42rem)] min-h-64 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-emerald-300 bg-white shadow-2xl">
            {renderAssistant(assistantWorkspace,()=>setAssistantOpen(false))}
          </div>:<Button type="button" aria-label={`Open ${title} AI assistant`} title={`Ask AI about ${title}`} onClick={()=>setAssistantOpen(true)} className="border border-orange-300 bg-orange-600 text-white shadow-lg hover:bg-orange-700"><Sparkles className="size-4"/>Ask AI</Button>}
        </div>}
        {compactView && resizable && resizeEdges.map(([edge, position]) => <div key={edge} aria-hidden="true" data-resize-edge={edge} className={`absolute z-20 touch-none select-none bg-transparent transition-colors hover:bg-primary/30 ${position}`} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}/>) }
      </div>
    </div>, document.body,
  )
}
