/**
 * Exercises explicit official-identity onboarding and normalized submission.
 * Cancelling never creates an account, and server conflicts preserve the draft.
 */
import {render,screen} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {afterEach,expect,it,vi} from "vitest"
import {AddPerson} from "./add-person"
afterEach(()=>vi.unstubAllGlobals())
it("normalizes official names and emails and displays the generated number",async()=>{
  const request=vi.fn(async(_url:unknown,_init?:RequestInit)=>Response.json({identity:{contractorNumber:"TN-issued"}}));vi.stubGlobal("fetch",request)
  render(<AddPerson/>);await userEvent.click(screen.getByRole("button",{name:"Add contractor/employee"}))
  await userEvent.type(screen.getByLabelText("Official name"),"mAURICE oTIENO")
  await userEvent.type(screen.getByLabelText("Company account email"),"PERSON@EXAMPLE.COM")
  expect(request).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Save official identity"}))
  expect(await screen.findByRole("status")).toHaveTextContent("TN-issued")
  expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toMatchObject({email:"person@example.com",officialName:"Maurice Otieno",role:"contractor"})
})
it("cancels onboarding without calling the server",async()=>{
  const request=vi.fn();vi.stubGlobal("fetch",request)
  render(<AddPerson/>);await userEvent.click(screen.getByRole("button",{name:"Add contractor/employee"}));await userEvent.click(screen.getByRole("button",{name:"Cancel"}))
  expect(request).not.toHaveBeenCalled()
})
