/**
 * Verifies recovery forms actually submit through the shared button primitive.
 * The browser-only passphrase reaches the crypto hook, never a request payload.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect,it,vi } from "vitest"
import { MessagesPanel } from "./messages-panel"
import { useMessageEncryption } from "./use-message-encryption"
import type { MessageInbox } from "./use-message-inbox"
vi.mock("./use-message-encryption",()=>({useMessageEncryption:vi.fn()}))
it("allows unlocking from the composer without losing its draft",async()=>{
  const unlock=vi.fn(async()=>true)
  vi.mocked(useMessageEncryption).mockReturnValue({own:{email:"manager@example.com"} as never,keys:[],plaintext:{},error:null,busy:false,loaded:true,unlocked:false,unlock,encrypt:vi.fn(),lock:vi.fn()})
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({users:[]}))))
  const inbox:MessageInbox={messages:[],email:"manager@example.com",admin:false,error:null,loading:false,unread:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
  render(<MessagesPanel canSend inbox={inbox}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"New message"}))
  await user.type(screen.getByRole("textbox",{name:"Message"}),"Draft remains private")
  expect(screen.getByRole("button",{name:"Send message"})).toBeDisabled()
  await user.click(screen.getByRole("button",{name:"Unlock messages"}))
  await user.type(screen.getByLabelText("Recovery passphrase"),"Disposable recovery passphrase")
  await user.click(screen.getByRole("button",{name:"Unlock messages"}))
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"Message settings"})).not.toBeInTheDocument())
  expect(screen.getByRole("textbox",{name:"Message"})).toHaveValue("Draft remains private")
  vi.unstubAllGlobals()
})
it("submits a recovery passphrase only to the browser crypto hook",async()=>{
  const unlock=vi.fn(async()=>true)
  vi.mocked(useMessageEncryption).mockReturnValue({own:{email:"employee@example.com"} as never,keys:[],plaintext:{},error:null,busy:false,loaded:true,unlocked:false,unlock,encrypt:vi.fn(),lock:vi.fn()})
  const inbox:MessageInbox={messages:[],email:"employee@example.com",admin:false,error:null,loading:false,unread:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
  render(<MessagesPanel canSend={false} inbox={inbox}/>)
  const user=userEvent.setup();await user.click(screen.getByRole("button",{name:"Unlock messages"}))
  await user.type(screen.getByLabelText("Recovery passphrase"),"Disposable recovery passphrase")
  expect(screen.getByRole("button",{name:"Unlock messages"})).toHaveAttribute("type","submit")
  await user.click(screen.getByRole("button",{name:"Unlock messages"}))
  await waitFor(()=>expect(unlock).toHaveBeenCalledWith("Disposable recovery passphrase"))
  expect(screen.queryByRole("dialog",{name:"Message settings"})).not.toBeInTheDocument()
})
