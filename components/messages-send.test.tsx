/**
 * Verifies the composer sends encrypted envelopes and reports setup blockers.
 * Synthetic recipients and mocked encryption keep plaintext away from requests.
 * Missing participant keys must not silently reduce a selected audience.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,beforeEach,expect,it,vi } from "vitest"
const { encrypt,cryptoState }=vi.hoisted(()=>({encrypt:vi.fn(),cryptoState:{ready:true}}))
vi.mock("./use-message-encryption",()=>({useMessageEncryption:()=>({own:null,keys:cryptoState.ready?[{email:"employee@example.com"},{email:"manager@example.com"}]:[],plaintext:{},error:null,busy:false,loaded:true,unlocked:true,unlock:vi.fn(),encrypt,lock:vi.fn()})}))
import { MessagesPanel } from "./messages-panel"
import { invalidateClientData } from "@/lib/client-data-cache"
import type { MessageInbox } from "./use-message-inbox"
const inbox:MessageInbox={messages:[],email:"manager@example.com",admin:false,error:null,loading:false,unread:0,notification:null,dismissNotification:vi.fn(),refresh:vi.fn()}
beforeEach(()=>{invalidateClientData();cryptoState.ready=true;encrypt.mockResolvedValue({ciphertext:"encrypted-envelope"})})
afterEach(()=>{invalidateClientData();vi.unstubAllGlobals();vi.clearAllMocks()})
/** @returns Fetch spy accepting a scoped roster and explicit message sends. */
function requests(){const request=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes("delegation")?{users:[{email:"employee@example.com",role:"employee",accessStatus:"active"}]}:{ok:true})));vi.stubGlobal("fetch",request);return request}
/** @returns Promise<void> after preparing an individual message without sending it. */
async function compose(){const user=userEvent.setup();await user.click(screen.getByRole("button",{name:"New message"}));await screen.findByRole("option",{name:"employee@example.com"});await user.selectOptions(screen.getByRole("combobox",{name:"Recipient"}),"employee@example.com");await user.type(screen.getByRole("textbox",{name:"Message"}),"Private hello")}
it("sends only an encrypted envelope after choosing a recipient",async()=>{
  const request=requests();render(<MessagesPanel canSend inbox={inbox}/>);await compose();await userEvent.click(screen.getByRole("button",{name:"Send message"}))
  await waitFor(()=>expect(inbox.refresh).toHaveBeenCalled())
  const send=request.mock.calls.find(call=>call[0].endsWith("/api/messages")) as unknown as [string,RequestInit]
  expect(send[1].body).toContain("encrypted-envelope");expect(send[1].body).not.toContain("Private hello")
})
it("reports missing encryption setup without posting or excluding anyone",async()=>{
  cryptoState.ready=false;const request=requests();render(<MessagesPanel canSend inbox={inbox}/>);await compose();await userEvent.click(screen.getByRole("button",{name:"Send message"}))
  expect(screen.getByRole("alert")).toHaveTextContent("No recipients were silently excluded")
  expect(request.mock.calls.some(call=>call[0].endsWith("/api/messages"))).toBe(false)
})
it("preserves the draft and explains uncertain delivery after a timeout",async()=>{
  requests()
  vi.mocked(fetch).mockImplementation(async input=>{
    if(String(input).includes("delegation"))return new Response(JSON.stringify({users:[{email:"employee@example.com",role:"employee",accessStatus:"active"}]}))
    throw Object.assign(new Error("timeout"),{name:"TimeoutError"})
  })
  render(<MessagesPanel canSend inbox={inbox}/>);await compose();await userEvent.click(screen.getByRole("button",{name:"Send message"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("server outcome is unknown")
  expect(screen.getByRole("textbox",{name:"Message"})).toHaveValue("Private hello")
  expect(screen.getByRole("button",{name:"Send message"})).toBeEnabled()
})
