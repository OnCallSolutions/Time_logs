import {fireEvent,render,screen,waitFor} from "@testing-library/react"
import {expect,it,vi} from "vitest"
import {PatronAccountActivity} from "./patron-account-activity"

it("marks rejected and returned timesheet events until the patron acknowledges them",async()=>{
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{
    if(init?.method==="POST")return Response.json({acknowledged:true})
    return Response.json({events:[
      {id:"123e4567-e89b-42d3-a456-426614174000",action:"entry_rejected",targetType:"time_entry",occurredAt:"2026-10-18T12:00:00Z",requiresAttention:true,acknowledged:false},
      {id:"223e4567-e89b-42d3-a456-426614174000",action:"entry_approved",targetType:"time_entry",occurredAt:"2026-10-18T11:00:00Z",requiresAttention:false,acknowledged:false},
    ]})
  })
  render(<PatronAccountActivity/>)
  const attention=await screen.findByRole("button",{name:/Acknowledge activity: A reviewer returned a timesheet entry for correction/})
  expect(screen.getByText("Needs attention")).toBeVisible()
  fireEvent.click(attention)
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/tanovo-time/api/account-activity",expect.objectContaining({method:"POST",body:JSON.stringify({eventId:"123e4567-e89b-42d3-a456-426614174000"})})))
  await waitFor(()=>expect(screen.queryByText("Needs attention")).not.toBeInTheDocument())
  expect(screen.getByText("A reviewer approved a timesheet entry")).toBeVisible()
  fetchMock.mockRestore()
})

it("restores the attention marker if acknowledgment fails",async()=>{
  vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>init?.method==="POST"?Response.json({error:"Unavailable"},{status:503}):Response.json({events:[
    {id:"323e4567-e89b-42d3-a456-426614174000",action:"timesheet_returned",targetType:"time_entry",occurredAt:"2026-10-18T12:00:00Z",requiresAttention:true,acknowledged:false},
  ]}))
  render(<PatronAccountActivity/>)
  fireEvent.click(await screen.findByRole("button",{name:/Acknowledge activity/}))
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable")
  expect(screen.getByText("Needs attention")).toBeVisible()
  vi.restoreAllMocks()
})
