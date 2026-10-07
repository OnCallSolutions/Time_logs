/**
 * Exercises integrated role navigation and the AI-to-human approval boundary.
 * API responses are fixtures so no real entries, identities, or model calls change.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { TimesheetApp } from "./timesheet-app"
vi.mock("@/components/account-profile",()=>({AccountProfile:()=>null}))
vi.mock("@/components/sign-out-button",()=>({SignOutButton:()=>null}))
vi.mock("@/components/note-input",()=>({NoteInput:()=> <p>Note extraction</p>}))
vi.mock("@/components/manager-report",()=>({ManagerReport:()=> <h2>Team report fixture</h2>}))
const entries = [
  {id:"submitted",contractor:"Employee A",date:"2026-10-07",hours:8,project:"Delivery",description:"Project work",status:"submitted"},
  {id:"rejected",contractor:"Employee B",date:"2026-10-07",hours:4,project:"Review",description:"Corrections",status:"rejected"},
]
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(async (url:string,init?:RequestInit)=> {
    if(url.endsWith("/api/review")) return Response.json({recommendations:[{entryId:"submitted",decision:"approved",reason:"No obvious inconsistency"}]})
    if(init?.method === "PATCH") return Response.json({entry:{...entries[0],status:"approved"}})
    if(url.endsWith("/api/entries")) return Response.json({entries})
    if(url.endsWith("/api/users")) return Response.json({users:[]})
    return Response.json({events:[]})
  }))
})
it("gives employees personal corrections without privileged controls",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  await screen.findByDisplayValue("Employee A")
  expect(screen.queryByRole("button",{name:/prepare ai review|ai security reports|^admin$/i})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:/needs correction/i}))
  expect(screen.queryByDisplayValue("Employee A")).not.toBeInTheDocument()
  expect(screen.getByDisplayValue("Employee B")).toBeInTheDocument()
})
it("keeps AI recommendations advisory until a manager confirms",async()=>{
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("heading",{name:"Pending approvals"})
  await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  await userEvent.click(await screen.findByRole("button",{name:"Review suggestion"}))
  const mutations = () => vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method === "PATCH")
  expect(mutations()).toHaveLength(0)
  const dialog = screen.getByRole("dialog",{name:"Approve entry"})
  await userEvent.click(within(dialog).getByRole("button",{name:"Approve entry"}))
  expect(mutations()).toHaveLength(1)
  expect(screen.getByRole("button",{name:/team entries/i})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Reports"})).toBeInTheDocument()
})
it("opens technology management and preserves admin approvals and reporting",async()=>{
  render(<TimesheetApp role="admin" userEmail="admin@example.com" />)
  await screen.findByRole("heading",{name:"Admin user directory"})
  expect(screen.getByRole("button",{name:"Employee access"})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"AI security reports"})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:/approvals/i})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Reports"})).toBeInTheDocument()
  expect(screen.getByText("Note extraction")).toBeInTheDocument()
})
