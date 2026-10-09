/**
 * Checks explicit message editing, confirmed deletion, and opened-message receipts.
 * Crypto identity management is isolated here; real primitives have separate tests.
 * No mutations are performed against live employee messages.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { MessagesPanel } from "./messages-panel"
import type { MessageInbox } from "./use-message-inbox"
vi.mock("./use-message-encryption",()=>({useMessageEncryption:()=>({own:null,keys:[],plaintext:{},error:null,busy:false,loaded:false,unlocked:true,unlock:vi.fn(),encrypt:vi.fn(),lock:vi.fn()})}))
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
it("keeps encryption controls out of the everyday inbox",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>)
  expect(screen.queryByText("Messaging encryption unlocked")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Message settings"}))
  expect(screen.getByRole("dialog",{name:"Message settings"})).toBeVisible()
  expect(screen.getByText("Messaging encryption unlocked")).toBeVisible()
})
it("filters message text and announcements without exposing mismatched conversations",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.type(screen.getByRole("textbox",{name:"Search messages"}),"not present")
  expect(screen.getByText("No matching messages.")).toBeVisible()
  await user.clear(screen.getByRole("textbox",{name:"Search messages"}))
  expect(screen.getByText("Original message")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Conversation"}),"broadcast")
  expect(screen.queryByText("Original message")).not.toBeInTheDocument()
})
/** @param incoming - Whether the fixture is a received message. @param expired - Whether its deadline elapsed. @returns Controlled inbox and refresh spy. */
function inbox(incoming=false,expired=false):MessageInbox{
  return {messages:[{id:"123e4567-e89b-42d3-a456-426614174000",sender_email:incoming?"employee@example.com":"manager@example.com",recipient_email:incoming?"manager@example.com":"employee@example.com",body:"Original message",created_at:new Date(Date.now()-(expired?61:1)*60000).toISOString()}],email:"manager@example.com",admin:false,error:null,loading:false,unread:incoming?1:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
}
/** @returns Mock fetch handling a roster and successful lifecycle mutations. */
function requests(){const fn=vi.fn(async (url:string)=>new Response(JSON.stringify(url.includes("delegation")?{users:[]}:{ok:true}),{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fn);return fn}
it("does not save edits until Save is clicked",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByText("manager@example.com → employee@example.com"))
  await user.click(screen.getByRole("button",{name:"Edit message"}))
  await user.clear(screen.getByRole("textbox"));await user.type(screen.getByRole("textbox"),"Updated message")
  expect(fetchMock.mock.calls.filter(call=>call[0].endsWith("/api/messages"))).toHaveLength(0)
  await user.click(screen.getByRole("button",{name:"Save message"}))
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"Edit message"})).not.toBeInTheDocument())
  expect(screen.getByRole("dialog",{name:"Message detail"})).toBeVisible()
  expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:expect.stringContaining("Updated message")}))
})
it("hides expired sender edits but retains an admin exemption",async()=>{
  requests();const state=inbox(false,true);const {rerender}=render(<MessagesPanel canSend inbox={state}/>)
  await userEvent.click(screen.getByText("manager@example.com → employee@example.com"))
  expect(screen.queryByRole("button",{name:"Edit message"})).not.toBeInTheDocument()
  rerender(<MessagesPanel canSend inbox={{...state,admin:true}}/>)
  expect(screen.getByRole("button",{name:"Edit message"})).toBeInTheDocument()
})
it("requires confirmation before deleting for everyone",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByText("manager@example.com → employee@example.com"));await user.click(screen.getByRole("button",{name:"Delete message"}))
  expect(fetchMock.mock.calls.filter(call=>call[0].endsWith("/api/messages"))).toHaveLength(0)
  await user.click(screen.getByRole("button",{name:"Delete for everyone"}))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"DELETE"})))
})
it("marks incoming messages read only after they are opened",async()=>{
  vi.spyOn(document,"visibilityState","get").mockReturnValue("visible")
  const fetchMock=requests();render(<MessagesPanel canSend={false} inbox={inbox(true)}/>)
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByText("employee@example.com → manager@example.com"))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:expect.stringContaining('"action":"read"')})))
})
