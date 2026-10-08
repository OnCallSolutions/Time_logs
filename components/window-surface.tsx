/**
 * Provides isolated application windows with consistent full-screen navigation.
 * Portals keep nested windows outside hidden parent surfaces. Background windows
 * remain mounted so Back restores their drafts, selection, and scroll position.
 */
"use client"
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDialogFocus } from "@/components/use-dialog-focus"

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
 * @param props.children - Existing window content and workflow controls.
 * @returns React portal containing the active application window.
 */
export function WindowSurface({ title, onBack, disabled = false, children }: {
  title: string; onBack: () => void; disabled?: boolean; children: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  const [mounted, setMounted] = useState(false)
  const ref = useDialogFocus<HTMLDivElement>(onBack, !disabled, mounted)
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
  return createPortal(
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      data-window-expanded={expanded}
      className={`window-surface tech-surface fixed inset-0 z-[70] flex min-h-0 flex-col bg-background ${expanded ? "p-0" : "p-3 sm:p-6"}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-white px-3 py-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onBack}><ArrowLeft className="size-4" />Back</Button>
        <Button variant="outline" size="icon-sm" title={expanded ? "Restore window" : "Expand window"}
          aria-label={expanded ? "Restore window" : "Expand window"} onClick={() => setExpanded(value => !value)}>
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>
      <div className="window-content flex min-h-0 flex-1 justify-center overflow-hidden">{children}</div>
    </div>, document.body,
  )
}
