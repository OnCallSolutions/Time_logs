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
it("keeps loaded history paginated and refreshes old deletion markers and receipts",async()=>{
  const recent={id:"recent",sender_email:"manager@example.com",recipient_email:"employee@example.com",body:"New",created_at:"2026-10-15T12:00:00Z"}
  const old={...recent,id:"old",body:"Old",created_at:"2026-10-14T12:00:00Z"}
  let deleted=false
  const request=vi.fn(async(url:string)=>Response.json(url.includes("?before=")?{messages:[old],next:null}:url.includes("?ids=")?{messages:[{...old,deleted_at:deleted?recent.created_at:null}]}:{email:"employee@example.com",role:"employee",messages:[recent],next:{date:recent.created_at,id:recent.id}}))
  vi.stubGlobal("fetch",request)
  const {result}=renderHook(()=>useMessageInbox())
  await waitFor(()=>expect(result.current.hasMore).toBe(true))
  await act(()=>result.current.loadOlder())
  expect(result.current.messages.map(message=>message.id)).toEqual(["recent","old"])
  expect(result.current.hasMore).toBe(false)
  deleted=true;act(()=>window.dispatchEvent(new Event("focus")))
  await waitFor(()=>expect(result.current.messages.find(message=>message.id==="old")?.deleted_at).toBe(recent.created_at))
  expect(result.current.hasMore).toBe(false)
})
