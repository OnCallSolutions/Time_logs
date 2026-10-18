import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { AssistantPanel } from "./assistant-panel"

afterEach(() => vi.unstubAllGlobals())

it("submits a question and only navigates after confirming the returned proposal", async () => {
  const onNavigate = vi.fn(), onRefresh = vi.fn(), onContextUsed = vi.fn(), onCompose = vi.fn()
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({id:"123e4567-e89b-42d3-a456-426614174000",messages:[]}))
    .mockResolvedValueOnce(Response.json({periods:[{id:"10000000-0000-4000-8000-000000000001",name:"Current period",startDate:"2026-01-01",endDate:"2026-12-31"}]}))
    .mockResolvedValueOnce(new Response(JSON.stringify({ answer: "Open your reports?", proposals: [{ token: "signed-token", action: { kind: "navigate", destination: "report" } }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ clientAction: { kind: "navigate", destination: "report" } })))
  vi.stubGlobal("fetch", fetch)
  render(<AssistantPanel onNavigate={onNavigate} onRefresh={onRefresh} messageContext="" onContextUsed={onContextUsed} onCompose={onCompose} />)
  const user = userEvent.setup()
  await waitFor(()=>expect(screen.getByRole("textbox",{name:"Ask DevOnCall"})).toBeEnabled())
  await user.type(screen.getByRole("textbox", { name: "Ask DevOnCall" }), "Open reports")
  await user.click(screen.getByRole("button", { name: "Send to assistant" }))
  expect(await screen.findByText("Open your reports?")).toBeVisible()
  expect(fetch.mock.calls[0][0]).toBe("/tanovo-time/api/assistant/conversations")
  expect(fetch.mock.calls[1][0]).toBe("/tanovo-time/api/timesheet-periods")
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Open reports" }], workspaceContext:"main",messageContext: undefined,periodId:"10000000-0000-4000-8000-000000000001" }) })
  await user.click(screen.getByRole("button", { name: "Review command" }))
  const confirmation=screen.getByRole("dialog",{name:"Review command"})
  await user.click(within(confirmation).getByRole("button",{name:"Open page"}))
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("report",expect.any(String)))
  expect(JSON.parse(onNavigate.mock.calls[0][1])).toMatchObject({sourceWorkspace:"main",messages:[{role:"user",content:"Open reports"},{role:"assistant",content:"Open your reports?"}]})
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(fetch.mock.calls[3][1]).toMatchObject({ method: "POST", body: JSON.stringify({ token: "signed-token" }) })
  expect(onRefresh).not.toHaveBeenCalled()
})

it("requires an in-chat popup confirmation before executing an assistant-proposed deletion", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({id:"123e4567-e89b-42d3-a456-426614174000",messages:[]}))
    .mockResolvedValueOnce(Response.json({periods:[{id:"10000000-0000-4000-8000-000000000001",name:"Current period",startDate:"2026-01-01",endDate:"2026-12-31"}]}))
    .mockResolvedValueOnce(new Response(JSON.stringify({ answer: "A deletion is available.", proposals: [{ token: "delete-token", action: { kind: "delete_entry", id: "123e4567-e89b-42d3-a456-426614174000", expectedRevision: "r1" } }] })))
  vi.stubGlobal("fetch", fetch)
  render(<AssistantPanel onNavigate={vi.fn()} onRefresh={vi.fn()} messageContext="" onContextUsed={vi.fn()} onCompose={vi.fn()} />)
  const user = userEvent.setup()
  await waitFor(()=>expect(screen.getByRole("textbox",{name:"Ask DevOnCall"})).toBeEnabled())
  await user.type(screen.getByRole("textbox", { name: "Ask DevOnCall" }), "Delete this entry")
  await user.click(screen.getByRole("button", { name: "Send to assistant" }))
  await user.click(await screen.findByRole("button", { name: "Review command" }))
  expect(fetch).toHaveBeenCalledTimes(3)
  const confirmation = screen.getByRole("dialog", { name: "Review command" })
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }))
  expect(fetch).toHaveBeenCalledTimes(3)
})

it("shows an explicit dock control when embedded in a workspace window",()=>{
  const onToggleDock=vi.fn()
  render(<AssistantPanel workspaceContext="Reports" docked onToggleDock={onToggleDock} onNavigate={vi.fn()} onRefresh={vi.fn()} messageContext="" onContextUsed={vi.fn()} onCompose={vi.fn()}/> )
  expect(screen.getByRole("button",{name:"Undock AI assistant"})).toBeVisible()
  screen.getByRole("button",{name:"Undock AI assistant"}).click()
  expect(onToggleDock).toHaveBeenCalledOnce()
})
