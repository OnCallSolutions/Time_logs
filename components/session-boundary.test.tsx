/**
 * Verifies restored workspaces are shielded until a live server session is checked.
 * Warning confirmation is explicit; focus and history restoration never renew idle.
 * Expiry removes sensitive children and never claims a network failure is success.
 */
import {fireEvent,render,screen,waitFor} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,expect,it,vi} from "vitest"
vi.mock("./sign-out-button",()=>({SignOutButton:()=> <button>Sign out</button>}))
import {SessionBoundary} from "./session-boundary"
import {WindowSurface} from "./window-surface"
afterEach(()=>vi.unstubAllGlobals())
/** @param seconds - Remaining idle seconds. @returns Synthetic authoritative server deadlines. */
function deadlines(seconds=1800){const now=Date.now();return{serverTime:new Date(now).toISOString(),expiresAt:new Date(now+seconds*1000).toISOString(),absoluteExpiresAt:new Date(now+8*3600000).toISOString()}}
it("checks a restored workspace before making its controls visible",async()=>{
  let complete!:(value:Response)=>void
  vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve})))
  render(<SessionBoundary><button>Approve private entry</button></SessionBoundary>)
  expect(screen.queryByRole("button",{name:"Approve private entry"})).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog",{name:"Session verification"})).not.toBeInTheDocument()
  complete(Response.json(deadlines()))
  expect(await screen.findByRole("button",{name:"Approve private entry"})).toBeVisible()
  expect(screen.queryByRole("dialog",{name:"Session verification"})).not.toBeInTheDocument()
})
it("shows the privacy shield only when session verification takes longer than the flicker delay",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(()=>{})))
  render(<SessionBoundary><p>Private work</p></SessionBoundary>)
  expect(screen.queryByRole("dialog",{name:"Session verification"})).not.toBeInTheDocument()
  expect(screen.getByText("Private work").closest("[hidden]")).not.toBeNull()
  expect(await screen.findByRole("dialog",{name:"Session verification"},{timeout:3000})).toBeVisible()
  expect(screen.getByRole("status")).toHaveTextContent("Checking your session...")
})
it("does not touch activity on restore and explicitly renews from the warning",async()=>{
  const request=vi.fn(async(_url:unknown,init?:RequestInit)=>Response.json(deadlines(init?.method==="POST"?1800:60)))
  vi.stubGlobal("fetch",request)
  render(<SessionBoundary><p>Work</p></SessionBoundary>)
  await screen.findByRole("dialog",{name:"Session ending soon"})
  expect(request.mock.calls.every(call=>call[1]?.method==="GET")).toBe(true)
  await userEvent.click(screen.getByRole("button",{name:"Stay signed in"}))
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(request.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1)
})
it("removes private content and requires sign-in when the server rejects the session",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Expired"},{status:401})))
  const expired=vi.fn();render(<SessionBoundary onExpired={expired}><p>Private work</p></SessionBoundary>)
  await waitFor(()=>expect(expired).toHaveBeenCalledOnce())
  expect(screen.queryByText("Private work")).not.toBeInTheDocument()
})
it("blocks stale controls on verification failure and provides a retry",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Unavailable"},{status:503})))
  render(<SessionBoundary><button>Approve private entry</button></SessionBoundary>)
  expect(await screen.findByRole("alert")).toHaveTextContent("verification unavailable")
  expect(screen.queryByRole("button",{name:"Approve private entry"})).not.toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Retry session check"})).toBeEnabled()
})
it("checks browser restore with GET rather than extending idle automatically",async()=>{
  const request=vi.fn(async()=>Response.json(deadlines()));vi.stubGlobal("fetch",request)
  render(<SessionBoundary><p>Work</p></SessionBoundary>)
  await screen.findByText("Work");fireEvent(window,new Event("pageshow"))
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(2))
  expect(request.mock.calls.every(call=>(call as unknown as [unknown,RequestInit])[1].method==="GET")).toBe(true)
})
it("keeps the workspace visible during routine tab-return verification",async()=>{
  const request=vi.fn()
    .mockResolvedValueOnce(Response.json(deadlines()))
    .mockImplementationOnce(()=>new Promise<Response>(()=>{}))
  vi.stubGlobal("fetch",request)
  render(<SessionBoundary><p>Work remains visible</p></SessionBoundary>)
  await screen.findByText("Work remains visible")
  fireEvent(document,new Event("visibilitychange"))
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(2))
  expect(screen.getByText("Work remains visible")).toBeVisible()
  expect(screen.queryByRole("dialog",{name:"Session verification"})).not.toBeInTheDocument()
})
it("shields an already-open private portal when restoring session verification fails",async()=>{
  const request=vi.fn().mockResolvedValueOnce(Response.json(deadlines())).mockResolvedValue(Response.json({error:"Unavailable"},{status:503}));vi.stubGlobal("fetch",request)
  render(<SessionBoundary><WindowSurface title="Private review" onBack={()=>{}}><section><button>Approve confidential work</button></section></WindowSurface></SessionBoundary>)
  await screen.findByRole("button",{name:"Approve confidential work"})
  fireEvent(window,new Event("pageshow"))
  expect(await screen.findByRole("alert")).toHaveTextContent("verification unavailable")
  expect(screen.queryByRole("button",{name:"Approve confidential work"})).not.toBeInTheDocument()
  expect(document.body).toHaveAttribute("data-session-checking","true")
  expect(screen.getByRole("dialog",{name:"Session verification"})).toBeVisible()
})
it("drops old account content when another tab changes the authenticated identity",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...deadlines(),email:"different@example.com"})))
  const expired=vi.fn()
  render(<SessionBoundary accountEmail="original@example.com" onExpired={expired}><p>Original account private work</p></SessionBoundary>)
  await waitFor(()=>expect(expired).toHaveBeenCalledOnce())
  expect(screen.queryByText("Original account private work")).not.toBeInTheDocument()
})
