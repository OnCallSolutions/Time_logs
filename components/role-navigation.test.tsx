/**
 * Exercises integrated role navigation and the AI-to-human approval boundary.
 * API responses are fixtures so no real entries, identities, or model calls change.
 */
import { act, fireEvent,render, screen, waitFor,within } from "@testing-library/react"
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
vi.mock("@/components/business-accounts",()=>({BusinessAccounts:()=> <h2>Business queue fixture</h2>}))
const entries = [
  {id:"submitted",contractor:"Employee A",ownerEmail:"employee@example.com",date:"2026-10-07",hours:8,project:"Delivery",description:"Project work",status:"submitted"},
  {id:"rejected",contractor:"Employee B",ownerEmail:"employee@example.com",date:"2026-10-07",hours:4,project:"Review",description:"Corrections",status:"rejected"},
]
let servedEntries=entries
beforeEach(()=>{
  testRole = "employee"; overrides = {}
  servedEntries=entries
  vi.stubGlobal("fetch",vi.fn(async (url:string,init?:RequestInit)=> {
    if(url.endsWith("/api/permissions")) return Response.json({role:testRole,permissions:resolvePermissions(testRole,overrides)})
    if(url.endsWith("/api/review")) return Response.json({recommendations:[{entryId:"submitted",decision:"approved",reason:"No obvious inconsistency"}]})
    if(url.endsWith("/api/security")) return Response.json({reports:[]})
    if(init?.method === "PATCH") return Response.json({entry:{...entries[0],status:"approved"}})
    if(url.endsWith("/api/entries")) return Response.json({entries:servedEntries})
    if(url.endsWith("/api/users")) return Response.json({users:[]})
    if(url.endsWith("/api/assistant/conversations")) return Response.json({id:"123e4567-e89b-42d3-a456-426614174000",messages:[]})
    if(url.includes("/api/assistant/runs")) return Response.json({runs:[],hasMore:false})
    return Response.json({events:[]})
  }))
})
it("gives employees personal corrections without privileged controls",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  expect(await screen.findByRole("region",{name:"employee workspace home"})).toBeVisible()
  expect(screen.queryByText("Employee A")).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:/prepare ai review|ai security reports|^admin$/i})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Timesheets"}))
  await screen.findByText("Employee A")
  const timesheets=screen.getByRole("dialog",{name:"My timesheets · All entries"})
  await userEvent.click(within(timesheets).getByRole("button",{name:/needs correction/i}))
  expect(await screen.findByRole("dialog",{name:"My timesheets · Needs correction"})).toBeVisible()
  expect(screen.getByRole("region",{name:"Needs correction timesheet workspace"})).toBeVisible()
  expect(screen.queryByText("Employee A")).not.toBeInTheDocument()
  expect(screen.getByText("Employee B")).toBeInTheDocument()
})
it("gives contractors a dedicated capture-first home without placing raw entries on it",async()=>{
  testRole="contractor"
  render(<TimesheetApp role="contractor" userEmail="contractor@example.com" />)
  const home=await screen.findByRole("region",{name:"contractor workspace home"})
  expect(within(home).getByRole("button",{name:/log project time/i})).toBeVisible()
  expect(within(home).getByRole("button",{name:/my submissions/i})).toBeVisible()
  expect(within(home).getByText(/Only your own database-registered timesheets/)).toBeVisible()
  expect(screen.queryByText("Employee A")).not.toBeInTheDocument()
})
it("keeps the assistant dock compact and vertically resizable beside the landing workspace",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  await screen.findByRole("region",{name:"employee workspace home"})
  await userEvent.click(screen.getByRole("button",{name:"Go to DevOnCall assistant"}))
  const grip=screen.getByRole("separator",{name:"Resize assistant panel"})
  expect(grip).toHaveAttribute("aria-valuenow","380")
  act(()=>{
    fireEvent.pointerDown(grip,{pointerId:1,clientY:100})
    fireEvent.pointerMove(grip,{pointerId:1,clientY:20})
  })
  expect(grip).toHaveAttribute("aria-valuenow","460")
})
it("keeps AI recommendations advisory until a manager confirms",async()=>{
  testRole = "manager"
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("region",{name:"manager workspace home"})
  await userEvent.click(screen.getByRole("button",{name:"Approvals"}))
  const approvals=await screen.findByRole("dialog",{name:"Review queue"})
  await userEvent.click(within(approvals).getByRole("button",{name:"Prepare AI review"}))
  await userEvent.click(await screen.findByRole("button",{name:"Review suggestion"}))
  const mutations = () => vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method === "PATCH")
  expect(mutations()).toHaveLength(0)
  const dialog = screen.getByRole("dialog",{name:"Approve entry"})
  await userEvent.click(within(dialog).getByRole("button",{name:"Approve entry"}))
  expect(mutations()).toHaveLength(1)
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"Approve entry"})).not.toBeInTheDocument())
  await userEvent.click(within(screen.getByRole("dialog",{name:"AI review results"})).getByRole("button",{name:"Back"}))
  await userEvent.click(within(approvals).getByRole("button",{name:"Back"}))
  await userEvent.click(screen.getByRole("button",{name:"Timesheets"}))
  expect(await screen.findByRole("dialog",{name:"Team entries"})).toBeInTheDocument()
})
it("returns from a report to the exact approval page and restores its filters",async()=>{
  testRole="manager"
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("region",{name:"manager workspace home"})
  await userEvent.click(screen.getByRole("button",{name:"Approvals"}))
  const approvals=await screen.findByRole("dialog",{name:"Review queue"})
  const search=within(approvals).getByRole("textbox",{name:"Search entries"})
  await userEvent.type(search,"Project work")
  await userEvent.click(within(approvals).getByRole("button",{name:"Team report"}))
  expect(await screen.findByRole("dialog",{name:"Reports"})).toBeVisible()
  await userEvent.click(within(screen.getByRole("dialog",{name:"Reports"})).getByRole("button",{name:"Back"}))
  const restored=await screen.findByRole("dialog",{name:"Review queue"})
  expect(within(restored).getByRole("textbox",{name:"Search entries"})).toHaveValue("Project work")
  expect(within(restored).getByText("Employee A")).toBeVisible()
})
it("groups admin tools beneath Admin, Reports, and Timesheets while preserving landing commands",async()=>{
  testRole = "admin"
  render(<TimesheetApp role="admin" userEmail="admin@example.com" />)
  expect(screen.queryByLabelText("Workspace views")).not.toBeInTheDocument()
  const dashboard=await screen.findByRole("navigation",{name:"Admin dashboard commands"})
  expect(screen.getByRole("region",{name:"People and access"})).toBeVisible()
  expect(screen.queryByRole("dialog",{name:"Admin dashboard"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Back"})).not.toBeInTheDocument()
  expect(within(dashboard).getAllByRole("button").map(button=>button.textContent?.trim())).toEqual(["Admin","Reports","Timesheets"])
  await userEvent.click(within(dashboard).getByRole("button",{name:"Admin"}))
  const adminWindow=await screen.findByRole("dialog",{name:"Admin"})
  expect(within(adminWindow).getByRole("button",{name:/patron access and rights/i})).toBeVisible()
  expect(within(adminWindow).queryByRole("button",{name:/security risks|activity logs/i})).not.toBeInTheDocument()
  await userEvent.click(within(adminWindow).getByRole("button",{name:"Back"}))
  await userEvent.click(within(dashboard).getByRole("button",{name:"Reports"}))
  const reportWindow=await screen.findByRole("dialog",{name:"Reports"})
  expect(within(reportWindow).getByRole("button",{name:"Open analytics report"})).toBeVisible()
  expect(within(reportWindow).getByRole("button",{name:"Open activity log"})).toBeVisible()
  expect(within(reportWindow).getByRole("button",{name:"Open security risks"})).toBeVisible()
  expect(within(reportWindow).getByRole("button",{name:"Open AI activity"})).toBeVisible()
  await userEvent.click(within(reportWindow).getByRole("button",{name:"Open activity log"}))
  expect(await screen.findByRole("dialog",{name:"All app activity"})).toBeVisible()
  await userEvent.click(within(screen.getByRole("dialog",{name:"All app activity"})).getByRole("button",{name:"Back"}))
  expect(reportWindow).toBeVisible()
  await userEvent.click(within(reportWindow).getByRole("button",{name:"Open security risks"}))
  expect(await screen.findByRole("dialog",{name:"Security risks"})).toBeVisible()
  await userEvent.click(within(screen.getByRole("dialog",{name:"Security risks"})).getByRole("button",{name:"Back"}))
  await userEvent.click(within(reportWindow).getByRole("button",{name:"Open AI activity"}))
  expect(await screen.findByRole("dialog",{name:"AI workflow activity"})).toBeVisible()
  expect(await screen.findByRole("table")).toBeVisible()
  await userEvent.click(within(screen.getByRole("dialog",{name:"AI workflow activity"})).getByRole("button",{name:"Back"}))
  await userEvent.click(within(reportWindow).getByRole("button",{name:"Back"}))
  await userEvent.click(within(dashboard).getByRole("button",{name:"Timesheets"}))
  const timesheetWindow=await screen.findByRole("dialog",{name:"Timesheets"})
  expect(within(timesheetWindow).getByRole("heading",{name:"Timesheet workbench"})).toBeVisible()
  expect(within(timesheetWindow).getByRole("heading",{name:"Raw timesheet entries"})).toBeVisible()
  expect(within(timesheetWindow).getByRole("button",{name:"Log time"})).toBeVisible()
  await userEvent.click(within(timesheetWindow).getByText("Review queue"))
  expect(within(timesheetWindow).getByRole("button",{name:"AI suggestions"})).toBeVisible()
  expect(within(timesheetWindow).getByRole("button",{name:"Refresh entries"})).toBeVisible()
  await userEvent.click(within(timesheetWindow).getByRole("button",{name:"Back"}))
  expect(screen.getByRole("region",{name:"People and access"})).toBeVisible()
  expect(screen.queryByRole("heading",{name:"Raw timesheet entries"})).not.toBeInTheDocument()
  expect(screen.getByRole("navigation",{name:"Workspaces"})).toBeVisible()
})
it("removes manager approval controls when rights are revoked in an open session",async()=>{
  testRole="manager"
  render(<TimesheetApp role="manager" userEmail="manager@example.com" />)
  await screen.findByRole("region",{name:"manager workspace home"})
  overrides={review_entries:false,ai_review:false}
  fireEvent(window,new Event("focus"))
  await waitFor(()=>expect(screen.queryByRole("button",{name:/^approvals/i})).not.toBeInTheDocument())
  expect(screen.queryByRole("button",{name:"Prepare AI review"})).not.toBeInTheDocument()
})
it("adds approval controls when an employee receives a delegated review right",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  await screen.findByRole("region",{name:"employee workspace home"})
  overrides={review_entries:true,view_team:true}
  fireEvent(window,new Event("focus"))
  await screen.findByRole("button",{name:"Approvals"})
  await userEvent.click(screen.getByRole("button",{name:"Approvals"}))
  expect(within(screen.getByRole("dialog",{name:"Review queue"})).getAllByRole("button",{name:/Review queue/i}).length).toBeGreaterThan(0)
  expect(screen.queryByRole("button",{name:"Admin"})).not.toBeInTheDocument()
})
it("keeps admin landing focused on people rather than timesheets or business queues",async()=>{
  testRole="admin"
  render(<TimesheetApp role="admin" userEmail="admin@example.com" />)
  expect(screen.queryByLabelText("Workspace views")).not.toBeInTheDocument()
  await screen.findByRole("region",{name:"People and access"})
  expect(screen.queryByRole("button",{name:"Back"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Business accounts"})).not.toBeInTheDocument()
  expect(screen.getByRole("navigation",{name:"Workspaces"})).toBeVisible()
  expect(screen.queryByRole("button",{name:"Business accounts"})).not.toBeInTheDocument()
  expect(screen.queryByRole("heading",{name:"Raw timesheet entries"})).not.toBeInTheDocument()
  await userEvent.click(within(screen.getByRole("navigation",{name:"Workspaces"})).getByRole("button",{name:"Timesheets"}))
  expect(await screen.findByRole("heading",{name:"Raw timesheet entries"})).toBeVisible()
})
it("opens the admin people home when live permissions promote the account to admin",async()=>{
  testRole="admin"
  render(<TimesheetApp role="employee" userEmail="admin@example.com" />)
  await screen.findByRole("region",{name:"People and access"})
  expect(screen.getByRole("heading",{name:"Technology management"})).toBeVisible()
  expect(screen.queryByRole("heading",{name:"Team entries"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Back"})).not.toBeInTheDocument()
})
it("refreshes the submitter's status and rejection reason when their browser regains focus",async()=>{
  render(<TimesheetApp role="employee" userEmail="employee@example.com" />)
  await screen.findByRole("region",{name:"employee workspace home"})
  await userEvent.click(screen.getByRole("button",{name:"Timesheets"}))
  await screen.findByText("Employee A")
  servedEntries=entries.map(entry=>entry.id==="submitted"?{...entry,status:"rejected",reviewNote:"Correct the submitted hours"}:entry)
  fireEvent(window,new Event("focus"))
  expect(await screen.findByText("Correct the submitted hours")).toBeVisible()
})
