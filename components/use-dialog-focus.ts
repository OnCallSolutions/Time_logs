/**
 * Coordinates keyboard focus and background scrolling for shared admin dialogs.
 * Focus stays inside the open window and returns to its trigger on dismissal.
 * A ref keeps callbacks current without restarting focus when draft values change.
 */
"use client"
import { useEffect, useRef } from "react"

/**
 * Locks page scrolling, handles Escape, and cycles Tab through visible controls.
 * @param onClose - Callback invoked when Escape dismisses the dialog.
 * @param dismissible - Whether dismissal is allowed during the current operation.
 * @returns React.RefObject<HTMLElement | null> assigned to the dialog container.
 */
export function useDialogFocus<T extends HTMLElement = HTMLElement>(onClose: () => void, dismissible = true) {
  const ref = useRef<T>(null)
  const state = useRef({ onClose, dismissible })
  state.current = { onClose, dismissible }
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    /**
     * Finds enabled, rendered controls after dynamic dialog contents change.
     * @returns HTMLElement[] in keyboard navigation order.
     */
    function controls(): HTMLElement[] {
      return Array.from(element!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
        .filter(control => control.getClientRects().length > 0)
    }
    ;(controls()[0] ?? element).focus()
    /**
     * Handles dismissal and prevents keyboard focus from leaving the dialog.
     * @param event - Native keyboard event from a dialog control.
     * @returns void.
     */
    function handleKey(event: KeyboardEvent): void {
      if ((event.target as HTMLElement).closest('[role="dialog"]') !== element) return
      if (event.key === "Escape" && state.current.dismissible) {
        event.preventDefault()
        state.current.onClose()
      }
      if (event.key !== "Tab") return
      const items = controls()
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); element!.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault(); last!.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault(); first.focus()
      }
    }
    element.addEventListener("keydown", handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      element.removeEventListener("keydown", handleKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return ref
}
