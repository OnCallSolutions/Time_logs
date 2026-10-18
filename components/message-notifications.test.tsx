/**
 * Verifies the notification center's unread list and explicit bulk-read action.
 * API and window boundaries are mocked; no live messages or browser sound are used.
 */
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { MessageNotifications } from "./message-notifications"

vi.mock("@/components/window-surface",()=>({WindowSurface:({title,children}:{title:string;children:ReactNode})=><div role="dialog" aria-label={title}>{children}</div>}))

const refresh=vi.fn(),dismissNotification=vi.fn(),onOpen=vi.fn()
const inbox={
  email:"admin@example.com",unread:2,loading:false,notification:null,error:null,admin:true,
  refresh,dismissNotification,onOpen,
  messages:[
    {id:"1",sender_email:"manager@example.com",sender_name:"Morgan Manager",recipient_email:"admin@example.com",body:"private body",created_at:"2026-10-16T13:00:00.000Z",read_at:null,deleted_at:null,priority:"high" as const},
    {id:"2",sender_email:"employee@example.com",sender_name:"Avery Employee",recipient_email:"admin@example.com",body:"another private body",created_at:"2026-10-16T12:00:00.000Z",read_at:null,deleted_at:null},
  ],
}

beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",vi.fn().mockImplementation(async(_input:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==="PATCH"?{ok:true}:{reminders:[{id:"deadline-1",title:"Timesheet deadline approaching",body:"October 2026 is due soon.",sender_label:"Business Accounts",created_at:"2026-10-16T13:00:00.000Z",read_at:null}]}})))})

it("keeps deadline notifications separate from casual messages and marks only reminders read",async()=>{
  const user=userEvent.setup()
  render(<MessageNotifications inbox={inbox} onOpen={onOpen}/> )
  await user.click(await screen.findByRole("button",{name:"Notifications, 1 unread"}))
  const center=screen.getByRole("dialog",{name:"Notification center"})
  expect(within(center).getByText(/October 2026 is due soon/)).toBeVisible()
  expect(within(center).queryByText(/Morgan Manager|Avery Employee/)).not.toBeInTheDocument()
  expect(center).not.toHaveTextContent("private body")
  await user.click(within(center).getByRole("button",{name:"Mark all as read"}))
  expect(fetch).toHaveBeenCalledWith("/tanovo-time/api/timesheet-period-reminders",expect.objectContaining({method:"PATCH",body:JSON.stringify({ids:["deadline-1"]})}))
  expect(fetch).not.toHaveBeenCalledWith("/tanovo-time/api/messages",expect.anything())
  expect(dismissNotification).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})

it("activates sound only after the preference click and plays a tone for a new alert",async()=>{
  const user=userEvent.setup()
  const oscillator={frequency:{value:0},connect:vi.fn(),start:vi.fn(),stop:vi.fn()}
  const gain={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn()}
  const resume=vi.fn(async function(this:{state:string}){this.state="running"})
  const contextConstructor=vi.fn()
  class TestAudioContext {
    state="suspended"
    currentTime=1
    destination={}
    resume=resume.bind(this)
    close=vi.fn()
    createOscillator=()=>oscillator
    createGain=()=>gain
    constructor(){contextConstructor()}
  }
  vi.stubGlobal("AudioContext",TestAudioContext)
  localStorage.removeItem("message-alerts:admin@example.com")
  const view=render(<MessageNotifications inbox={inbox} onOpen={onOpen}/> )

  await user.click(await screen.findByRole("button",{name:"Notifications, 1 unread"}))
  const center=screen.getByRole("dialog",{name:"Notification center"})
  await user.click(within(center).getByRole("button",{name:"Test sound"}))
  await waitFor(()=>expect(oscillator.start).toHaveBeenCalledOnce())
  expect(localStorage.getItem("message-alerts:admin@example.com")).toBeNull()
  await user.click(within(center).getByLabelText("Message sound"))
  await waitFor(()=>expect(resume).toHaveBeenCalledTimes(2))
  expect(contextConstructor).toHaveBeenCalledOnce()
  expect(JSON.parse(localStorage.getItem("message-alerts:admin@example.com")??"{}").sound).toBe(true)

  view.rerender(<MessageNotifications inbox={{...inbox,notification:inbox.messages[0]}} onOpen={onOpen}/> )
  await waitFor(()=>expect(oscillator.start).toHaveBeenCalledTimes(2))
  expect(oscillator.frequency.value).toBe(660)
})
