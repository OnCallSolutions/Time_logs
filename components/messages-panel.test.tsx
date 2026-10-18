/**
 * Checks explicit message editing, confirmed deletion, and opened-message receipts.
 * Crypto identity management is isolated here; real primitives have separate tests.
 * No mutations are performed against live employee messages.
 */
import { fireEvent,render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { MessagesPanel } from "./messages-panel"
import type { MessageInbox } from "./use-message-inbox"
vi.mock("./use-message-encryption",()=>({useMessageEncryption:()=>({own:null,keys:[],plaintext:{},error:null,busy:false,loaded:false,unlocked:true,unlock:vi.fn(),encrypt:vi.fn(),lock:vi.fn()})}))
const originalClipboard=Object.getOwnPropertyDescriptor(navigator,"clipboard")
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();if(originalClipboard)Object.defineProperty(navigator,"clipboard",originalClipboard);else Reflect.deleteProperty(navigator,"clipboard")})
it("keeps encryption controls out of the everyday inbox",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>)
  expect(screen.queryByText("End-to-end encryption connected")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Message settings"}))
  expect(screen.getByRole("dialog",{name:"Message settings"})).toBeVisible()
  expect(screen.getByText("Messages connected")).toBeVisible()
  expect(screen.queryByRole("button",{name:"Device identities"})).not.toBeInTheDocument()
})
it("lets a user turn off read receipts from message settings",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Message settings"}))
  const toggle=screen.getByRole("checkbox",{name:"Send read receipts"})
  expect(toggle).toBeChecked()
  await user.click(toggle)
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:JSON.stringify({action:"read_receipts",enabled:false})})))
  expect(toggle).not.toBeChecked()
  expect(screen.getByText(/Your own unread counts still work/)).toBeVisible()
})
it("lets patrons choose which side their sent messages use",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"Message settings"}))
  const left=screen.getByRole("button",{name:"Left"}),right=screen.getByRole("button",{name:"Right"})
  expect(right).toHaveAttribute("aria-pressed","true")
  await user.click(left)
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:JSON.stringify({action:"own_message_alignment",alignment:"left"})})))
})
it("shows sender-first inbox cards and opens a chronological thread with navigation",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  expect(screen.getByRole("button",{name:/Taylor/})).toBeVisible()
  expect(screen.getByAltText("Taylor profile photo")).toHaveAttribute("src","/tanovo-time/api/messages/avatar?email=employee%40example.com")
  expect(screen.queryByText("Original message")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button",{name:/Taylor/}))
  expect(screen.getByRole("heading",{name:"Taylor"})).toBeVisible()
  expect(screen.getByRole("separator",{name:"Today"})).toBeVisible()
  expect(screen.getByText("You",{selector:"span"})).toBeVisible()
  expect(screen.getByRole("button",{name:"Scroll to top"})).toBeVisible()
  expect(screen.getByRole("button",{name:"Scroll to bottom"})).toBeVisible()
  expect(screen.getByRole("textbox",{name:"Search conversation"})).toBeVisible()
  expect(screen.getByLabelText("Scroll to date")).toBeVisible()
  await user.click(screen.getByRole("button",{name:"Back to message inbox"}))
  expect(screen.getByRole("button",{name:/Taylor/})).toBeVisible()
})
it("filters the landing inbox by a selected sender",async()=>{
  const state=inbox()
  state.messages.push({id:"523e4567-e89b-42d3-a456-426614174000",sender_email:"other@example.com",sender_name:"Jordan Other",recipient_email:"manager@example.com",recipient_name:"Morgan Manager",body:"Second sender message",created_at:new Date().toISOString()})
  requests();render(<MessagesPanel canSend={false} inbox={state}/>);const user=userEvent.setup()
  expect(screen.getByRole("button",{name:/Taylor/})).toBeVisible()
  expect(screen.getByRole("button",{name:/Jordan, 1 unread, latest message: Second sender message/})).toBeVisible()
  expect(screen.getByLabelText("1 unread")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Filter by sender"}),"other@example.com")
  expect(screen.queryByRole("button",{name:/Taylor/})).not.toBeInTheDocument()
  expect(screen.getByRole("button",{name:/Jordan/})).toBeVisible()
})
it("separates announcements from individual sender conversations",async()=>{
  const state=inbox(true)
  state.messages=[{id:"223e4567-e89b-42d3-a456-426614174000",sender_email:"admin@example.com",sender_name:"Riley Admin",recipient_email:null,recipient_name:"All recipients",body:"Office update",created_at:new Date().toISOString()},...state.messages]
  requests();render(<MessagesPanel canSend={false} inbox={state}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Announcements/}))
  expect(screen.getByRole("heading",{name:"Announcements"})).toBeVisible()
  expect(screen.getByRole("button",{name:/Office update/})).toBeVisible()
  expect(screen.queryByText("Riley Admin → You")).not.toBeInTheDocument()
})
it("orders an individual thread oldest at top and latest at bottom with first-name labels",async()=>{
  const state=inbox(true),now=Date.now()
  state.messages=[
    {id:"323e4567-e89b-42d3-a456-426614174000",sender_email:"employee@example.com",sender_name:"Alex Employee",recipient_email:"manager@example.com",recipient_name:"Morgan Manager",body:"Latest incoming",created_at:new Date(now).toISOString()},
    {id:"423e4567-e89b-42d3-a456-426614174000",sender_email:"manager@example.com",sender_name:"You",recipient_email:"employee@example.com",recipient_name:"Alex Employee",body:"Earlier outgoing",created_at:new Date(now-60000).toISOString()},
  ]
  requests();render(<MessagesPanel canSend inbox={state}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Alex/}))
  const history=screen.getByLabelText("Message history"),text=history.textContent??""
  expect(text.indexOf("Earlier outgoing")).toBeLessThan(text.indexOf("Latest incoming"))
  expect(screen.getByRole("separator",{name:"Today"})).toHaveClass("my-2")
  expect(screen.getByRole("separator",{name:"Today"})).not.toHaveClass("sticky")
  expect(screen.getByText("Alex",{selector:"span"})).toBeVisible()
  expect(screen.getAllByAltText("Alex profile photo")).toHaveLength(2)
  expect(text).not.toContain("→")
})
it("sizes message bubbles to their content while capping them at half width on desktop",async()=>{
  requests()
  const state=inbox()
  state.messages[0].body="Short note"
  render(<MessagesPanel canSend inbox={state}/>);await userEvent.click(screen.getByRole("button",{name:/Taylor/}))
  const bubble=screen.getByText("Short note").closest("div.rounded-lg")
  expect(bubble).toHaveClass("w-fit","max-w-[85%]","sm:max-w-[50%]")
  expect(screen.getByLabelText("Message history")).toHaveClass("min-h-0","flex-1","overflow-auto","overscroll-contain")
})
it("separates messages by local calendar day in the open thread",async()=>{
  const state=inbox(),today=new Date(),yesterday=new Date(today);yesterday.setDate(today.getDate()-1)
  state.messages=[
    {...state.messages[0],created_at:new Date(today.getFullYear(),today.getMonth(),today.getDate(),12).toISOString()},
    {id:"623e4567-e89b-42d3-a456-426614174000",sender_email:"employee@example.com",sender_name:"Alex Employee",recipient_email:"manager@example.com",recipient_name:"Morgan Manager",body:"Yesterday note",created_at:new Date(yesterday.getFullYear(),yesterday.getMonth(),yesterday.getDate(),12).toISOString()},
  ]
  requests();render(<MessagesPanel canSend inbox={state}/>);await userEvent.click(screen.getByRole("button",{name:/Taylor/}))
  expect(screen.getByRole("separator",{name:"Today"})).toBeVisible()
  expect(screen.getByRole("separator",{name:"Yesterday"})).toBeVisible()
})
it("jumps to a selected calendar date within the open thread",async()=>{
  requests();const state=inbox();render(<MessagesPanel canSend inbox={state}/>);await userEvent.click(screen.getByRole("button",{name:/Taylor/}))
  const created=new Date(state.messages[0].created_at),day=`${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,"0")}-${String(created.getDate()).padStart(2,"0")}`
  fireEvent.change(screen.getByLabelText("Scroll to date"),{target:{value:day}})
  expect(await screen.findByText(`Jumped to ${day}.`)).toBeVisible()
})
/** @param incoming - Whether the fixture is a received message. @param expired - Whether its deadline elapsed. @returns Controlled inbox and refresh spy. */
function inbox(incoming=false,expired=false):MessageInbox{
  return {messages:[{id:"123e4567-e89b-42d3-a456-426614174000",sender_email:incoming?"employee@example.com":"manager@example.com",sender_name:incoming?"Alex Employee":"You",recipient_email:incoming?"manager@example.com":"employee@example.com",recipient_name:"Taylor Contractor",body:"Original message",created_at:new Date(Date.now()-(expired?61:1)*60000).toISOString()}],email:"manager@example.com",admin:false,error:null,loading:false,unread:incoming?1:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
}
/** @returns Mock fetch handling a roster and successful lifecycle mutations. */
function requests(){const fn=vi.fn(async (url:string)=>new Response(JSON.stringify(url.includes("delegation")?{users:[]}:{ok:true}),{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fn);return fn}
it("does not save edits until Save is clicked",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Taylor/}))
  await user.click(screen.getByRole("button",{name:/Original message/}))
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
  await userEvent.click(screen.getByRole("button",{name:/Taylor/}))
  await userEvent.click(screen.getByRole("button",{name:/Original message/}))
  expect(screen.queryByRole("button",{name:"Edit message"})).not.toBeInTheDocument()
  rerender(<MessagesPanel canSend inbox={{...state,admin:true}}/>)
  expect(screen.getByRole("button",{name:"Edit message"})).toBeInTheDocument()
})
it("requires confirmation before deleting for everyone",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Taylor/}));await user.click(screen.getByRole("button",{name:"Message options for You"}));await user.click(screen.getByRole("menuitem",{name:"Delete for everyone"}))
  expect(fetchMock.mock.calls.filter(call=>call[0].endsWith("/api/messages"))).toHaveLength(0)
  await user.click(screen.getByRole("button",{name:"Delete for everyone"}))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"DELETE"})))
})
it("offers delete-for-me for incoming messages and keeps it local",async()=>{
  const fetchMock=requests();render(<MessagesPanel canSend={false} inbox={inbox(true)}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Alex/}));await user.click(screen.getByRole("button",{name:"Message options for Alex"}));await user.click(screen.getByRole("menuitem",{name:"Delete for me"}))
  await user.click(screen.getByRole("button",{name:"Delete for me"}))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:expect.stringContaining('"action":"delete_for_me"')})))
})
it("marks incoming messages read only after they are opened",async()=>{
  vi.spyOn(document,"visibilityState","get").mockReturnValue("visible")
  const fetchMock=requests();render(<MessagesPanel canSend={false} inbox={inbox(true)}/>)
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:/Alex/}))
  await userEvent.click(screen.getByRole("button",{name:/Original message/}))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:expect.stringContaining('"action":"read"')})))
})
it("offers copy and explicit mark-as-read actions for an unread received message",async()=>{
  const user=userEvent.setup()
  const writeText=vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText,readText:vi.fn()}})
  const fetchMock=requests();render(<MessagesPanel canSend={false} inbox={inbox(true)}/>);
  await user.click(screen.getByRole("button",{name:/Alex/}))
  await user.click(screen.getByRole("button",{name:"Message options for Alex"}))
  expect(screen.getByRole("menuitem",{name:"Copy message"})).toBeVisible()
  expect(screen.getByRole("menuitem",{name:"Mark as read"})).toBeVisible()
  await user.click(screen.getByRole("menuitem",{name:"Copy message"}))
  await waitFor(()=>expect(writeText).toHaveBeenCalledWith("Original message"))
  await user.click(screen.getByRole("button",{name:"Message options for Alex"}))
  await user.click(screen.getByRole("menuitem",{name:"Mark as read"}))
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/messages",expect.objectContaining({method:"PATCH",body:expect.stringContaining('"action":"read"')})))
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
})
it("dismisses the message options menu on outside clicks before another command runs",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Taylor/}))
  await user.click(screen.getByRole("button",{name:"Message options for You"}))
  expect(screen.getByRole("menu")).toBeVisible()
  await user.click(screen.getByRole("button",{name:"Scroll to top"}))
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Scroll to top"})).toBeVisible()
})
it("dismisses the message options menu with Escape",async()=>{
  requests();render(<MessagesPanel canSend inbox={inbox()}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:/Taylor/}))
  await user.click(screen.getByRole("button",{name:"Message options for You"}))
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
})
it("anchors a reply composer below message history and pastes at the current caret",async()=>{
  const user=userEvent.setup()
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:vi.fn(),readText:vi.fn().mockResolvedValue("Pasted draft")}})
  requests();render(<MessagesPanel canSend inbox={inbox()}/>);
  await user.click(screen.getByRole("button",{name:/Taylor/}))
  const history=screen.getByLabelText("Message history")
  const composer=screen.getByRole("form",{name:"Reply composer"})
  expect(history.compareDocumentPosition(composer)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(screen.getByRole("button",{name:"Paste from clipboard"}))
  expect(await screen.findByRole("textbox",{name:"Message Taylor"})).toHaveValue("Pasted draft")
  expect(screen.getByRole("button",{name:"Send reply"})).toBeEnabled()
})
