"use client"

import { useEffect, useRef, useState } from "react"

const retainedViewState = new Map<string, unknown>()
let nextEphemeralViewId = 0

/** Retains non-sensitive view controls while a workspace is temporarily unmounted. */
export function useRetainedViewState<T>(key: string | undefined, initialValue: T): [T, (value: T | ((current: T) => T)) => void] {
  const instanceId=useRef<string | null>(null)
  if(instanceId.current===null)instanceId.current=`ephemeral:${++nextEphemeralViewId}`
  const retainedKey=key??instanceId.current
  const [value, setValue] = useState<T>(() => retainedViewState.has(retainedKey) ? retainedViewState.get(retainedKey) as T : initialValue)
  useEffect(() => { retainedViewState.set(retainedKey, value) }, [retainedKey, value])
  return [value, setValue]
}
