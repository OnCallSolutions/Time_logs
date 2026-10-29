import { afterEach,expect,it,vi } from "vitest"
import { cleanup,render,screen } from "@testing-library/react"
import { SubmissionDeadlineNotice } from "./submission-deadline-notice"

afterEach(()=>{cleanup();vi.unstubAllGlobals()})

it("shows the exact active-period deadline in the shared patron shell",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({periods:[{
    id:"active",name:"October cycle",startDate:"2000-01-01",endDate:"2099-12-31",submissionDeadline:"2099-12-31T17:30:00.000Z",
  }]}),{status:200,headers:{"Content-Type":"application/json"}})))
  render(<SubmissionDeadlineNotice/>)
  expect(await screen.findByLabelText("Timesheet submission deadline")).toHaveTextContent(/October cycle · Submit by/)
})

it("falls back to the organization deadline when periods are not configured",async()=>{
  vi.stubGlobal("fetch",vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({periods:[]}),{status:200,headers:{"Content-Type":"application/json"}}))
    .mockResolvedValueOnce(new Response(JSON.stringify({deadline:"2099-12-31T17:30:00.000Z"}),{status:200,headers:{"Content-Type":"application/json"}})))
  render(<SubmissionDeadlineNotice/>)
  expect(await screen.findByLabelText("Timesheet submission deadline")).toHaveTextContent(/Submit by/)
})
