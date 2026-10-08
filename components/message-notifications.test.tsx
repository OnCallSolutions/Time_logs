/**
 * Checks privacy-safe popups and opt-in notification sound behavior.
 * Audio primitives are mocked, so tests do not play audio on the host machine.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { MessageNotifications } from "./message-notifications"
import type { MessageInbox } from "./use-message-inbox"
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear()})
/**
 * Builds notification state independently of polling or authentication services.
 * @returns MessageInbox fixture containing no initial popup.
 */
function inbox():MessageInbox{return {messages:[],email:"employee@example.com",admin:false,error:null,loading:false,unread:1,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}}
it("plays sound only after opt-in and suppresses duplicate alerts",async()=>{
  const start=vi.fn();const resume=vi.fn()
  class Audio{
    state="running";currentTime=0;destination={}
    resume=resume;close=vi.fn(async()=>{})
    createOscillator(){return {frequency:{value:0},connect:vi.fn(),start,stop:vi.fn()}}
    createGain(){return {gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn()}}
  }
  vi.stubGlobal("AudioContext",Audio)
  const state=inbox();const onOpen=vi.fn();const {rerender}=render(<MessageNotifications inbox={state} onOpen={onOpen}/>)
  expect(start).not.toHaveBeenCalled()
  const user=userEvent.setup();await user.click(screen.getByText("Notifications"));await user.click(screen.getByRole("checkbox",{name:/Message sound/}))
  await waitFor(()=>expect(resume).toHaveBeenCalledOnce())
  const received={id:"new",sender_email:"manager@example.com",recipient_email:state.email,body:"Private message content",created_at:new Date().toISOString()}
  rerender(<MessageNotifications inbox={{...state,notification:received}} onOpen={onOpen}/>)
  await waitFor(()=>expect(start).toHaveBeenCalledOnce())
  expect(screen.getByText("New message")).toBeInTheDocument()
  expect(screen.queryByText("Private message content")).not.toBeInTheDocument()
  rerender(<MessageNotifications inbox={{...state,notification:received}} onOpen={onOpen}/>)
  expect(start).toHaveBeenCalledOnce()
  await user.click(screen.getByRole("button",{name:/^Open$/}))
  expect(onOpen).toHaveBeenCalledOnce();expect(state.dismissNotification).toHaveBeenCalledOnce()
})
