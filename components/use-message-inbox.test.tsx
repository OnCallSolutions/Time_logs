/**
 * Verifies notifications remain active outside the inbox without alerting history.
 * Scoped synthetic messages exercise refresh, unread counts, and self suppression.
 */
import { act,renderHook,waitFor } from "@testing-library/react"
import { afterEach,expect,it,vi } from "vitest"
import { useMessageInbox } from "./use-message-inbox"
afterEach(()=>vi.unstubAllGlobals())
it("announces only new incoming IDs and never automatically reads them",async()=>{
  let messages:object[]=[]
  const fetchMock=vi.fn(async()=>new Response(JSON.stringify({email:"employee@example.com",role:"employee",messages})))
  vi.stubGlobal("fetch",fetchMock)
  const {result}=renderHook(()=>useMessageInbox())
  await waitFor(()=>expect(result.current.loading).toBe(false))
  expect(result.current.notification).toBeNull()
  messages=[{id:"new",sender_email:"manager@example.com",recipient_email:"employee@example.com",body:"Encrypted message",created_at:new Date().toISOString()}]
  act(()=>window.dispatchEvent(new Event("focus")))
  await waitFor(()=>expect(result.current.unread).toBe(1))
  expect(result.current.notification?.id).toBe("new")
  act(()=>result.current.dismissNotification())
  act(()=>window.dispatchEvent(new Event("focus")))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3))
  expect(result.current.notification).toBeNull()
  for(const call of fetchMock.mock.calls as unknown as [string,RequestInit][])expect(call[1].method).toBeUndefined()
})
it("does not alert historical or self-authored messages",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({email:"manager@example.com",role:"manager",messages:[{id:"old",sender_email:"employee@example.com",body:"Earlier",created_at:new Date().toISOString()},{id:"own",sender_email:"manager@example.com",body:"Sent",created_at:new Date().toISOString()}]}))))
  const {result}=renderHook(()=>useMessageInbox())
  await waitFor(()=>expect(result.current.loading).toBe(false))
  expect(result.current.unread).toBe(1)
  expect(result.current.notification).toBeNull()
})
