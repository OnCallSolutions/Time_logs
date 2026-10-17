"use client"

type WindowBackEntry = { id: number; onBack: () => void }

const markerKey = "__tanovoWindowBackSentinel"
const activeWindows: WindowBackEntry[] = []
let nextWindowId = 0
let nextSentinelId = 0
let activeSentinel: number | null = null
let removeSentinelTimer: number | null = null
let repushSentinelTimer: number | null = null
let suppressNextPop = false
let listenerInstalled = false

function stateWithMarker(state: unknown, id: number): Record<string, unknown> {
  return { ...(state && typeof state === "object" ? state as Record<string, unknown> : {}), [markerKey]: id }
}

function pushSentinel(): void {
  if (activeSentinel !== null || activeWindows.length === 0) return
  const id = ++nextSentinelId
  window.history.pushState(stateWithMarker(window.history.state, id), "", window.location.href)
  activeSentinel = id
}

function handlePopState(event: PopStateEvent): void {
  if (suppressNextPop) {
    suppressNextPop = false
    return
  }
  if (activeSentinel === null) return
  if ((event.state as Record<string, unknown> | null)?.[markerKey] === activeSentinel) return

  activeSentinel = null
  const current = activeWindows.at(-1)
  current?.onBack()
  repushSentinelTimer = window.setTimeout(() => {
    repushSentinelTimer = null
    pushSentinel()
  }, 0)
}

function removeSentinel(): void {
  removeSentinelTimer = null
  if (activeWindows.length || activeSentinel === null) return
  const marker = (window.history.state as Record<string, unknown> | null)?.[markerKey]
  if (marker !== activeSentinel) {
    activeSentinel = null
    return
  }
  activeSentinel = null
  suppressNextPop = true
  window.history.back()
}

export function createWindowHistoryId(): number {
  return ++nextWindowId
}

export function registerWindowBack(id: number, onBack: () => void): () => void {
  if (!listenerInstalled) {
    window.addEventListener("popstate", handlePopState)
    listenerInstalled = true
  }
  if (removeSentinelTimer !== null) {
    window.clearTimeout(removeSentinelTimer)
    removeSentinelTimer = null
  }
  if (repushSentinelTimer !== null) {
    window.clearTimeout(repushSentinelTimer)
    repushSentinelTimer = null
  }
  const existing = activeWindows.findIndex(entry => entry.id === id)
  if (existing >= 0) activeWindows.splice(existing, 1)
  activeWindows.push({ id, onBack })

  const marker = (window.history.state as Record<string, unknown> | null)?.[markerKey]
  if (activeSentinel === null && typeof marker === "number") activeSentinel = marker
  pushSentinel()

  return () => {
    const index = activeWindows.findIndex(entry => entry.id === id)
    if (index >= 0) activeWindows.splice(index, 1)
    if (activeWindows.length === 0 && activeSentinel !== null) {
      removeSentinelTimer = window.setTimeout(removeSentinel, 0)
    }
  }
}
