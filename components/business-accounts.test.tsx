/**
 * Exercises financial queue presentation using synthetic approved evidence.
 * Verifies category filtering and permission-gated controls without live APIs.
 * Explicit confirmation prevents incidental UI clicks from changing review state.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,it,expect,vi } from "vitest"
import { BusinessAccounts } from "./business-accounts"
const row={id:"123e4567-e89b-42d3-a456-426614174000",assigned_to:"accounts@example.com",current:true,review_state:"pending",review_version:0,evidence:{contractor:"Supplier",workerCategory:"contractor",reviewedBy:"manager@example.com",project:"Build",date:"2026-10-09",hours:4}}
afterEach(()=>vi.unstubAllGlobals())
/**
 * Installs an isolated queue fixture with both internal and outsourced evidence.
 * @returns Mock fetch recording all attempted mutations.
 */
function fixture(){const fetch=vi.fn(async()=>new Response(JSON.stringify({candidates:[],assignees:[],handoffs:[row,{...row,id:"second",evidence:{...row.evidence,contractor:"Staff",workerCategory:"employee"}}]})));vi.stubGlobal("fetch",fetch);return fetch}
it("shows a compact triage summary and filters employee evidence",async()=>{
  fixture();render(<BusinessAccounts canSend={false}/>);await screen.findByText("Supplier",{selector:"span"})
  expect(screen.getByRole("heading",{name:"Final hours and finance review"})).toBeVisible()
  expect(screen.getByText(/human-confirmed decision.*payment execution is not enabled/i)).toBeVisible()
  expect(screen.getByLabelText("Business queue summary")).toBeVisible()
  expect(screen.getByRole("columnheader",{name:"Approved by"})).toBeVisible()
  expect(screen.getAllByText("manager@example.com").length).toBeGreaterThan(1)
  expect(screen.queryByRole("button",{name:"Sample preview"})).not.toBeInTheDocument()
  await userEvent.click(screen.getByText("Filter and sort"))
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Category"}),"employee")
  expect(screen.queryByText("Supplier",{selector:"span"})).not.toBeInTheDocument();expect(screen.getByText("Staff",{selector:"span"})).toBeVisible()
  expect(screen.queryByRole("button",{name:"Review"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"AI review"})).not.toBeInTheDocument()
})
it("nests period controls inside the final approval dashboard when authorized",async()=>{
  const onManagePeriods=vi.fn();fixture();render(<BusinessAccounts canSend={false} onManagePeriods={onManagePeriods}/>);await screen.findByText("Supplier",{selector:"span"})
  await userEvent.click(screen.getByRole("button",{name:"Timesheet periods"}))
  expect(onManagePeriods).toHaveBeenCalledOnce()
})
it("requires an explicit review note before saving",async()=>{
  const fetch=fixture();render(<BusinessAccounts canSend={false} canReview/>);await screen.findByText("Supplier",{selector:"span"})
  await userEvent.click(screen.getAllByRole("button",{name:"Review"})[0])
  expect(screen.getByRole("button",{name:"Confirm review"})).toBeDisabled()
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
})
it("groups the queue by manager and drills into that manager's people",async()=>{
  fixture();render(<BusinessAccounts canSend={false}/>);await screen.findByText("Supplier",{selector:"span"})
  expect(screen.getAllByText(/Manager · manager@example\.com/)[0]).toBeVisible()
  await userEvent.click(screen.getByText("Filter and sort"))
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Approving reviewer"}),"manager@example.com")
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Manager contractor filter"}),"Supplier")
  expect(screen.getByText("Supplier",{selector:"span"})).toBeVisible()
  expect(screen.queryByText("Staff",{selector:"span"})).not.toBeInTheDocument()
})
