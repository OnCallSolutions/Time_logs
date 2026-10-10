/**
 * Verifies messaging connects automatically without exposing encryption forms.
 * Drafts remain intact while setup runs; settings contain no recovery inputs.
 * Real key generation, enrollment, and envelope behavior have separate tests.
 */
import { render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { MessagesPanel } from "./messages-panel"
import { useMessageEncryption } from "./use-message-encryption"
import type { MessageInbox } from "./use-message-inbox"
vi.mock("./use-message-encryption",()=>({useMessageEncryption:vi.fn()}))
afterEach(()=>vi.unstubAllGlobals())
const inbox:MessageInbox={messages:[],email:"manager@example.com",admin:false,error:null,loading:false,unread:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
it("keeps a draft while automatic connection is in progress",async()=>{
  vi.mocked(useMessageEncryption).mockReturnValue({own:null,keys:[],plaintext:{},error:null,busy:false,loaded:false,unlocked:false,unlock:vi.fn(),encrypt:vi.fn(),lock:vi.fn(),retry:vi.fn()})
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({users:[]}))))
  render(<MessagesPanel canSend inbox={inbox}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"New message"}));await user.type(screen.getByRole("textbox",{name:"Message"}),"Private draft")
  expect(screen.getByRole("status")).toHaveTextContent("Connecting secure messaging automatically")
  expect(screen.getByRole("textbox",{name:"Message"})).toHaveValue("Private draft")
  expect(screen.queryByRole("button",{name:"Unlock messages"})).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/recovery passphrase/i)).not.toBeInTheDocument()
})
it("never asks for a messaging password even in settings",async()=>{
  vi.mocked(useMessageEncryption).mockReturnValue({own:null,keys:[],plaintext:{},error:null,busy:false,loaded:true,unlocked:true,unlock:vi.fn(),encrypt:vi.fn(),lock:vi.fn(),retry:vi.fn()})
  render(<MessagesPanel canSend={false} inbox={inbox}/>);await userEvent.click(screen.getByRole("button",{name:"Message settings"}))
  expect(screen.getByText("End-to-end encryption connected")).toBeVisible()
  expect(screen.queryByLabelText(/passphrase|password/i)).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:/set up encryption|unlock messages/i})).not.toBeInTheDocument()
})
