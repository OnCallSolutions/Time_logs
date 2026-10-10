/**
 * Exercises integrated role navigation and the AI-to-human approval boundary.
 * API responses are fixtures so no real entries, identities, or model calls change.
 */
import { fireEvent,render, screen, waitFor,within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { TimesheetApp } from "./timesheet-app"
import { resolvePermissions, type PermissionOverrides } from "@/lib/permissions"
import type { UserRole } from "@/lib/types"
let testRole: UserRole = "employee"
let overrides: PermissionOverrides = {}
vi.mock("@/components/account-profile",()=>({AccountProfile:()=>null}))
vi.mock("@/components/sign-out-button",()=>({SignOutButton:()=>null}))
vi.mock("@/components/note-input",()=>({NoteInput:()=> <p>Note extraction</p>}))
vi.mock("@/components/manager-report",()=>({ManagerReport:()=> <h2>Team report fixture</h2>}))
const entries = [
  {id:"submitted",contractor:"Employee A",date:"2026-10-07",hours:8,project:"Delivery",description:"Project work",status:"submitted"},
  {id:"rejected",contractor:"Employee B",date:"2026-10-07",hours:4,project:"Review",description:"Corrections",status:"rejected"},
]
beforeEach(()=>{
  testRole = "employee"; overrides = {}
  vi.stubGlobal("fetch",vi.fn(async (url:string,init?:RequestInit)=> {
    if(url.endsWith("/api/permissions")) return Response.json({role:testRole,permissions:resolvePermissions(testRole,overrides)})
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
  testRole = "manager"
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("heading",{name:"Pending approvals"})
  await userEvent.click(screen.getByRole("button",{name:"Prepare AI review"}))
  await userEvent.click(await screen.findByRole("button",{name:"Review suggestion"}))
  const mutations = () => vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method === "PATCH")
  expect(mutations()).toHaveLength(0)
  const dialog = screen.getByRole("dialog",{name:"Approve entry"})
  await userEvent.click(within(dialog).getByRole("button",{name:"Approve entry"}))
  expect(mutations()).toHaveLength(1)
  await userEvent.click(within(screen.getByRole("dialog",{name:"AI review results"})).getByRole("button",{name:"Back"}))
  expect(screen.getByRole("button",{name:/team entries/i})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Reports"})).toBeInTheDocument()
})
it("opens technology management and preserves admin approvals and reporting",async()=>{
  testRole = "admin"
  render(<TimesheetApp role="admin" userEmail="admin@example.com" />)
  await screen.findByRole("button",{name:"User directory"})
  expect(screen.getByRole("button",{name:"Employee access"})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"AI security reports"})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:/approvals/i})).toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Reports"})).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Log time notes"}))
  expect(screen.getByText("Note extraction")).toBeInTheDocument()
})
it("removes manager approval controls when rights are revoked in an open session",async()=>{
  testRole="manager"
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("heading",{name:"Pending approvals"})
  overrides={review_entries:false,ai_review:false}
  fireEvent(window,new Event("focus"))
  await waitFor(()=>expect(screen.queryByRole("button",{name:/^approvals/i})).not.toBeInTheDocument())
  expect(screen.queryByRole("button",{name:"Prepare AI review"})).not.toBeInTheDocument()
})
it("adds approval controls when an employee receives a delegated review right",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  await screen.findByDisplayValue("Employee A")
  overrides={review_entries:true,view_team:true}
  fireEvent(window,new Event("focus"))
  await screen.findByRole("button",{name:/^approvals/i})
  expect(screen.queryByRole("button",{name:"Admin"})).not.toBeInTheDocument()
})
