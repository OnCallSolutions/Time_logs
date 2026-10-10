/**
 * Exercises visible outcomes for the manager's AI preparation control.
 * Empty queues, unavailable services, and successful advice never approve work.
 * Server requests include explicit eligible IDs rather than client evidence text.
 */
import { render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { ManagerWorkspace } from "./manager-workspace"
const row={id:"123e4567-e89b-42d3-a456-426614174000",contractor:"Person",date:"2026-10-10",hours:4,project:"Project",description:"Work",status:"submitted" as const,revision:"revision"}
const callbacks={onApprovals:vi.fn(),onReports:vi.fn(),onRecommendation:vi.fn()}
afterEach(()=>vi.unstubAllGlobals())
it("explains empty review lanes instead of presenting a dead button",async()=>{
  const request=vi.fn();vi.stubGlobal("fetch",request)
  render(<ManagerWorkspace pending={0} entries={[]} {...callbacks}/>);await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  expect(screen.getByRole("dialog",{name:"AI review results"})).toBeVisible()
  expect(screen.getByRole("status")).toHaveTextContent("No submitted entries are eligible")
  expect(request).not.toHaveBeenCalled()
})
it("shows advice in a results window without making a decision",async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({reviewedCount:1,recommendations:[{entryId:row.id,revision:row.revision,decision:"needs_review",reason:"Check evidence"}]})));vi.stubGlobal("fetch",request)
  const decision=vi.fn();render(<ManagerWorkspace pending={1} entries={[row]} {...callbacks} onRecommendation={decision}/>);await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  expect(await screen.findByText("Check evidence")).toBeVisible();expect(decision).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith(expect.stringContaining("/api/review"),expect.objectContaining({body:JSON.stringify({ids:[row.id]})}))
})
it("shows service errors within the explicit review window",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:"AI review unavailable"}),{status:503})))
  render(<ManagerWorkspace pending={1} entries={[row]} {...callbacks}/>);await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("AI review unavailable")
})
it("reports timed-out analysis without leaving the button busy",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>{throw Object.assign(new Error("timeout"),{name:"TimeoutError"})}))
  render(<ManagerWorkspace pending={1} entries={[row]} {...callbacks}/>);await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("No decisions were applied")
  expect(screen.getByRole("button",{name:"Back"})).toBeEnabled()
})
