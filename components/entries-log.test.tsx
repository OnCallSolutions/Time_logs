/**
 * Checks project grouping without collapsing distinct work records.
 * Both entries retain independent editing and submission controls.
 */
import { render,screen,within,waitFor,act,fireEvent,cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
vi.mock("@/lib/timesheet-pdf",()=>({downloadTimesheetPdf:vi.fn()}))
import {downloadTimesheetPdf} from "@/lib/timesheet-pdf"
vi.mock("@/lib/timesheet-export",()=>({downloadTimesheetExport:vi.fn()}))
import {downloadTimesheetExport} from "@/lib/timesheet-export"
import { EntriesLog } from "./entries-log"
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it("keeps multiple same-project work units as separate entries",()=>{
  const row={id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft" as const}
  render(<EntriesLog entries={[row,{...row,id:"two",hours:3,description:"Testing"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/>)
  expect(screen.getByText((_,node)=>node?.tagName==="TH"&&node.textContent==="Project: Project A 2 entries · 5h")).toBeVisible()
  const projectHeader=screen.getByText((_,node)=>node?.tagName==="TH"&&node.textContent==="Project: Project A 2 entries · 5h")
  expect(projectHeader.closest("tr")).toHaveClass("bg-sky-100")
  expect(projectHeader.closest("tr")).not.toHaveClass("hover:bg-sky-800")
  expect(screen.getByLabelText("Entry Documentation")).toHaveClass("hover:!bg-orange-100","hover:!text-slate-950")
  expect(screen.getAllByRole("button",{name:"Edit entry"})).toHaveLength(2)
  expect(screen.getAllByRole("button",{name:"Edit entry"})[0]).toHaveClass("border-orange-300","bg-orange-50","text-orange-800")
  expect(screen.queryByRole("spinbutton",{name:"Hours"})).not.toBeInTheDocument()
  expect(screen.getAllByText("Person")).toHaveLength(2)
  expect(screen.getByText("Documentation")).toBeVisible()
  expect(screen.getByText("Testing")).toBeVisible()
  expect(screen.getByText("Documentation").closest("td")).toHaveClass("px-1.5","py-1")
  expect(screen.getAllByText("Draft").find((node)=>node.tagName==="SPAN")).toHaveClass("rounded-full","text-[10px]")
})

it("uses distinct green and red row fills for approved and rejected entries",()=>{
  render(<EntriesLog entries={[
    {...entry,id:"approved",description:"Approved work",status:"approved"},
    {...entry,id:"rejected",description:"Rejected work",status:"rejected"},
    {...entry,id:"draft",description:"Draft work",status:"draft"},
  ]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(screen.getByLabelText("Entry Approved work")).toHaveClass("bg-emerald-100","border-l-emerald-600")
  expect(screen.getByLabelText("Entry Rejected work")).toHaveClass("bg-red-100","border-l-red-600")
  expect(screen.getByLabelText("Entry Draft work")).toHaveClass("bg-slate-50/70")
})

it("leaves edge scrolling to the browser so wheel momentum is not replaced with jumps",()=>{
  const {container}=render(<section style={{overflowY:"auto"}}><EntriesLog entries={[{id:"scroll",contractor:"Person",project:"Project",date:"2026-10-10",hours:2,description:"Work",status:"draft"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/></section>)
  const parent=container.querySelector("section")!,tableScroller=screen.getByLabelText("Scrollable time entries")
  expect(tableScroller).toHaveClass("min-h-0","flex-1","border-2","border-slate-600")
  Object.defineProperties(parent,{scrollHeight:{configurable:true,value:900},clientHeight:{configurable:true,value:400},scrollTop:{configurable:true,writable:true,value:0}})
  Object.defineProperties(tableScroller,{scrollHeight:{configurable:true,value:600},clientHeight:{configurable:true,value:300},scrollTop:{configurable:true,writable:true,value:300}})
  const wheel=new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:120})
  tableScroller.dispatchEvent(wheel)
  expect(wheel.defaultPrevented).toBe(false)
  expect(parent.scrollTop).toBe(0)
  expect(tableScroller).toHaveClass("timesheet-scroll-region","overscroll-y-auto")
})

it("exposes filtered CSV export only when the caller has the explicit export right",()=>{
  const onUpdate=vi.fn(),onStatusChange=vi.fn(),onDelete=vi.fn(),onClear=vi.fn()
  const props={entries:[entry],onUpdate,onStatusChange,onDelete,onClear}
  const {rerender}=render(<EntriesLog {...props}/> )
  expect(screen.queryByRole("button",{name:/export visible/i})).not.toBeInTheDocument()
  rerender(<EntriesLog {...props} canExport/> )
  expect(screen.getByRole("button",{name:"Export (1)"})).toBeEnabled()
})

it("keeps export discoverable on headerless and empty timesheet pages",()=>{
  const actions={onUpdate:vi.fn(),onStatusChange:vi.fn(),onDelete:vi.fn(),onClear:vi.fn()}
  const {rerender}=render(<EntriesLog entries={[entry]} hideHeader canExport {...actions}/> )
  expect(screen.getByRole("button",{name:"Export (1)"})).toBeVisible()
  expect(screen.queryByRole("heading",{name:"Time entries"})).not.toBeInTheDocument()
  rerender(<EntriesLog entries={[]} canExport {...actions}/> )
  expect(screen.getByRole("button",{name:"Export timesheets"})).toBeDisabled()
})

it("presents every supported export format to authorized patrons",async()=>{
  const user=userEvent.setup()
  const {rerender}=render(<EntriesLog entries={[entry]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(screen.queryByRole("button",{name:"Export (1)"})).not.toBeInTheDocument()
  rerender(<EntriesLog entries={[{...entry,description:"<script>alert(1)</script>"}]} canExport onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  await user.click(screen.getByRole("button",{name:"Export (1)"}))
  expect(screen.getByText(/Download current view · 1 entry/)).toBeVisible()
  for(const name of ["Download Excel (.xlsx)","Download OpenDocument (.ods)","Download CSV (.csv)","Download JSON (.json)","Download color PDF (.pdf)","Download black & white PDF (.pdf)","Preview and choose format…"]){
    expect(screen.getByRole("menuitem",{name})).toBeVisible()
  }
  vi.mocked(downloadTimesheetExport).mockResolvedValue()
  await user.click(screen.getByRole("menuitem",{name:"Download color PDF (.pdf)"}))
  await waitFor(()=>expect(downloadTimesheetExport).toHaveBeenCalledWith([{...entry,description:"<script>alert(1)</script>"}],"pdf-color",expect.objectContaining({groupBy:"project",sortBy:"date_newest"})))
  expect(screen.queryByRole("menu")).not.toBeInTheDocument()
})

it("previews the current rows and downloads the chosen format from that preview",async()=>{
  const user=userEvent.setup()
  const rows=[entry,{...entry,id:"two",description:"Second visible row",hours:3}]
  render(<EntriesLog entries={rows} canExport onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  await user.click(screen.getByRole("button",{name:"Export (2)"}))
  await user.click(screen.getByRole("menuitem",{name:/Preview and choose format/}))
  expect(await screen.findByRole("dialog",{name:"Timesheet export preview"})).toBeVisible()
  const preview=screen.getByRole("dialog",{name:"Timesheet export preview"})
  expect(within(preview).getByText("Documentation")).toBeVisible()
  expect(within(preview).getByText("Second visible row")).toBeVisible()
  expect(within(preview).getByText("5h")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Export format"}),"json")
  vi.mocked(downloadTimesheetExport).mockResolvedValue()
  await user.click(screen.getByRole("button",{name:"Download"}))
  await waitFor(()=>expect(downloadTimesheetExport).toHaveBeenCalledWith(rows,"json",expect.objectContaining({groupBy:"project"})))
})

it("passes the active filters, period, sort and grouping to the PDF export",async()=>{
  const user=userEvent.setup()
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({periods:[]}),{status:200,headers:{"Content-Type":"application/json"}})))
  const rows=[
    {...entry,id:"match",contractor:"Patron",project:"Alpha",date:"2026-10-18",description:"Visible record",status:"approved" as const},
    {...entry,id:"hidden",contractor:"Other",project:"Beta",date:"2026-10-17",description:"Hidden record",status:"draft" as const},
  ]
  render(<EntriesLog periodView initialPeriodSelection="all" entries={rows} canExport onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(await screen.findByText("Visible record")).toBeVisible()
  await user.click(screen.getByText(/More controls/))
  await user.type(screen.getByRole("textbox",{name:"Search entries"}),"Patron")
  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry status"}),"approved")
  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry project"}),"Alpha")
  await user.selectOptions(screen.getByRole("combobox",{name:"Sort entries"}),"hours_high")
  await user.selectOptions(screen.getByRole("combobox",{name:"Group entries"}),"person")
  await user.click(screen.getByRole("button",{name:"Export (1)"}))
  vi.mocked(downloadTimesheetExport).mockResolvedValue()
  await user.click(screen.getByRole("menuitem",{name:"Download black & white PDF (.pdf)"}))
  expect(downloadTimesheetExport).toHaveBeenCalledWith([rows[0]],"pdf-grayscale",expect.objectContaining({
    period:"All saved periods",search:"Patron",status:"approved",project:"Alpha",sortBy:"hours_high",groupBy:"person",
  }))
})

it("filters timesheets by text, status, project and date, with selectable sort and grouping",async()=>{
  const user=userEvent.setup()
  const rows=[
    {id:"one",ownerEmail:"ann@example.com",contractor:"Ann",project:"Alpha",date:"2026-10-10",hours:2,description:"Design notes",status:"draft" as const},
    {id:"two",ownerEmail:"bo@example.com",contractor:"Bo",project:"Beta",date:"2026-10-12",hours:5,description:"Build release",status:"submitted" as const},
    {id:"three",ownerEmail:"cy@example.com",contractor:"Cy",project:"Beta",date:"2026-10-08",hours:3,description:"Test suite",status:"rejected" as const},
  ]
  render(<EntriesLog entries={rows} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )

  expect(screen.getByRole("textbox",{name:"Search entries"})).toBeVisible()
  expect(screen.getByLabelText("Entries from date")).not.toBeVisible()
  await user.click(screen.getByText(/More controls/))
  await user.type(screen.getByRole("textbox",{name:"Search entries"}),"Build release")
  expect(screen.getByText("Build release")).toBeVisible()
  expect(screen.queryByText("Design notes")).not.toBeInTheDocument()
  expect(screen.getByLabelText("Entries from date")).toBeVisible()
  await user.click(screen.getByRole("button",{name:"Reset timesheet view"}))

  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry project"}),"Beta")
  expect(screen.getByText((_,node)=>node?.tagName==="TH"&&node.textContent==="Project: Beta 2 entries · 8h")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Sort entries"}),"hours_low")
  const rowTexts=screen.getAllByRole("row").map(row=>row.textContent??"")
  expect(rowTexts.findIndex(text=>text.includes("Test suite"))).toBeLessThan(rowTexts.findIndex(text=>text.includes("Build release")))

  await user.selectOptions(screen.getByRole("combobox",{name:"Group entries"}),"day")
  expect(screen.getByText(/Day: 2026-10-08/)).toBeVisible()
  fireEvent.change(screen.getByLabelText("Entries from date"),{target:{value:"2026-10-10"}})
  expect(screen.queryByText("Test suite")).not.toBeInTheDocument()
  expect(screen.getByText("Build release")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry status"}),"submitted")
  expect(screen.getByText(/1 visible/)).toBeVisible()
})

it("shows only the active period by default and retrieves archived entries on request",async()=>{
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-")
  const periods=[
    {id:"active",name:"Current Cycle",startDate:today,endDate:today,submissionDeadline:"2099-12-31T23:59:00.000Z",managerGraceDays:3},
    {id:"archive",name:"January 2000",startDate:"2000-01-01",endDate:"2000-01-31",submissionDeadline:"2000-02-05T00:00:00.000Z",managerGraceDays:3},
  ]
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({periods}),{status:200,headers:{"Content-Type":"application/json"}})))
  const rows=[
    {id:"current",contractor:"Person",project:"Now",date:today,hours:2,description:"Current work",status:"draft" as const},
    {id:"old",contractor:"Person",project:"Archive",date:"2000-01-12",hours:3,description:"Archived work",status:"approved" as const},
  ]
  render(<EntriesLog periodView entries={rows} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(await screen.findByText("Current work")).toBeVisible()
  expect(screen.queryByText("Archived work")).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Timesheet period"}),"archived")
  expect(await screen.findByText("Archived work")).toBeVisible()
  expect(screen.queryByText("Current work")).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Timesheet period"}),"archive")
  expect(screen.getByText("Archived work")).toBeVisible()
})

it("centers patron bulk selection, manual submission, and AI preparation above the entries",async()=>{
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-")
  vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes("timesheet-periods")?{periods:[{id:"current",name:"Current",startDate:today,endDate:today,submissionDeadline:"2099-12-31T23:59:00.000Z",managerGraceDays:3}]}:{requests:[]}),{status:200,headers:{"Content-Type":"application/json"}}))))
  render(<EntriesLog periodView showPatronBulkActions canSubmit userEmail="person@example.com" entries={[{...entry,date:today}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  const center=await screen.findByLabelText("Bulk timesheet submission")
  expect(within(center).getByRole("button",{name:"Select eligible (1)"})).toBeEnabled()
  expect(within(center).getByRole("button",{name:"Submit selected (0)"})).toBeDisabled()
  expect(within(center).getByRole("button",{name:"AI prepare selected (0)"})).toBeDisabled()
  await userEvent.click(within(center).getByRole("button",{name:"Select eligible (1)"}))
  expect(within(center).getByRole("button",{name:"Submit selected (1)"})).toBeEnabled()
  expect(within(center).getByRole("button",{name:"AI prepare selected (1)"})).toBeEnabled()
  await userEvent.click(screen.getByText("More controls"))
  expect(within(screen.getByLabelText("More timesheet controls")).queryByRole("button",{name:/Submit selected/})).not.toBeInTheDocument()
})

it("shows the exact submit-by deadline for the selected period",async()=>{
  const periods=[
    {id:"active",name:"Current Cycle",startDate:"2026-01-01",endDate:"2099-12-31",submissionDeadline:"2099-12-31T17:30:00.000Z",managerGraceDays:3},
    {id:"archive",name:"January 2000",startDate:"2000-01-01",endDate:"2000-01-31",submissionDeadline:"2000-02-05T17:00:00.000Z",managerGraceDays:3},
  ]
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({periods}),{status:200,headers:{"Content-Type":"application/json"}})))
  render(<EntriesLog periodView entries={[{id:"old",contractor:"Person",project:"Archive",date:"2000-01-12",hours:3,description:"Archived work",status:"approved"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(await screen.findByText(/Current Cycle · Submit by/)).toBeVisible()
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Timesheet period"}),"archive")
  expect(screen.getByText(/January 2000 · Submit by/)).toBeVisible()
  expect(screen.getByText(/deadline passed/i)).toBeVisible()
})

it("keeps a contractor's past-period entries visible but read-only",async()=>{
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-")
  const periods=[
    {id:"active",name:"Current Cycle",startDate:today,endDate:today,submissionDeadline:"2099-12-31T23:59:00.000Z",managerGraceDays:3},
    {id:"archive",name:"January 2000",startDate:"2000-01-01",endDate:"2000-01-31",submissionDeadline:"2000-02-05T00:00:00.000Z",managerGraceDays:3},
  ]
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({periods}),{status:200,headers:{"Content-Type":"application/json"}})))
  render(<EntriesLog periodView readOnlyArchivedForOwner userEmail="person@example.com" canEdit canDelete canSubmit entries={[{id:"old",ownerEmail:"person@example.com",contractor:"Person",project:"Archive",date:"2000-01-12",hours:3,description:"Archived draft",status:"draft"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  await userEvent.selectOptions(await screen.findByRole("combobox",{name:"Timesheet period"}),"archive")
  expect(await screen.findByText("Archived draft")).toBeVisible()
  expect(screen.queryByRole("button",{name:"Edit entry"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Delete entry"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Submit entry"})).not.toBeInTheDocument()
})

it("requires a confirmation window before deleting an entry",async()=>{
  const onDelete=vi.fn()
  const user=userEvent.setup()
  render(<EntriesLog entries={[{id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={onDelete} onClear={vi.fn()}/> )
  await user.click(screen.getByRole("button",{name:"Delete entry"}))
  const dialog=await screen.findByRole("dialog",{name:"Confirm entry deletion"})
  expect(onDelete).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole("button",{name:"Cancel"}))
  expect(onDelete).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button",{name:"Delete entry"}))
  const secondDialog=await screen.findByRole("dialog",{name:"Confirm entry deletion"})
  await user.click(within(secondDialog).getByRole("button",{name:"Delete entry"}))
  expect(onDelete).toHaveBeenCalledExactlyOnceWith("one")
})

it("hides deletion for a manager's other people's entries while retaining their own delete control",()=>{
  const foreign={...entry,id:"foreign",ownerEmail:"employee@example.com",status:"rejected" as const}
  const {rerender}=render(<EntriesLog entries={[foreign]} userEmail="manager@example.com" canDelete deleteOwnOnly onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(screen.queryByRole("button",{name:"Delete entry"})).not.toBeInTheDocument()
  rerender(<EntriesLog entries={[entry]} userEmail="person@example.com" canDelete deleteOwnOnly onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )
  expect(screen.getByRole("button",{name:"Delete entry"})).toBeVisible()
})

it("requires confirmation before requesting a clear-all operation",async()=>{
  const onClear=vi.fn()
  const user=userEvent.setup()
  render(<EntriesLog entries={[{id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft"}]} canClear onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={onClear}/> )
  await user.click(screen.getByRole("button",{name:"Clear all"}))
  const dialog=await screen.findByRole("dialog",{name:"Confirm clearing timesheets"})
  expect(dialog).toHaveAttribute("data-window-size","compact")
  expect(within(dialog).getByText("Loaded entries")).toBeVisible()
  expect(within(dialog).getByText("Total hours")).toBeVisible()
  expect(within(dialog).getByText("2h")).toBeVisible()
  expect(onClear).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole("button",{name:"Continue to secure verification"}))
  expect(onClear).toHaveBeenCalledOnce()
})

const entry={id:"one",ownerEmail:"person@example.com",revision:"original",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft" as const}
/**
 * Mounts the shared log with isolated persistence spies and optional overrides.
 * @param overrides - Test-specific props, records, or asynchronous callbacks.
 * @returns Render helpers and the observed update/transition callbacks.
 */
function setup(overrides:Partial<React.ComponentProps<typeof EntriesLog>>={}) {
  const update=vi.fn(),transition=vi.fn()
  return {update,transition,...render(<EntriesLog entries={[entry]} userEmail="person@example.com" onUpdate={update} onStatusChange={transition} onDelete={vi.fn()} onClear={vi.fn()} {...overrides}/>)}
}

it("keeps typing local and cancels back to the original saved values",async()=>{
  const {update}=setup()
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  await userEvent.clear(screen.getByLabelText("Description"))
  await userEvent.type(screen.getByLabelText("Description"),"Uncommitted typing")
  expect(update).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Cancel edit"}))
  expect(screen.getByText("Documentation")).toBeVisible()
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  expect(screen.getByLabelText("Description")).toHaveValue("Documentation")
  expect(update).not.toHaveBeenCalled()
})

it("saves a complete draft once with its opening revision and fractional hours",async()=>{
  const {update}=setup()
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  await userEvent.clear(screen.getByLabelText("Hours"))
  await userEvent.type(screen.getByLabelText("Hours"),"1.75")
  await userEvent.type(screen.getByLabelText("Description")," updated")
  expect(update).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button",{name:"Save entry"}))
  expect(update).toHaveBeenCalledExactlyOnceWith("one",{contractor:"Person",project:"Project A",date:"2026-10-10",hours:1.75,description:"Documentation updated"},"original")
  expect(screen.queryByLabelText("Hours")).not.toBeInTheDocument()
})

it("retains the draft and displays a failed save rather than discarding input",async()=>{
  const update=vi.fn().mockRejectedValue(new Error("Evidence changed. Refresh first."))
  setup({onUpdate:update})
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  await userEvent.type(screen.getByLabelText("Description")," revised")
  await userEvent.click(screen.getByRole("button",{name:"Save entry"}))
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence changed")
  expect(screen.getByLabelText("Description")).toHaveValue("Documentation revised")
})

it("does not coerce empty hours to zero or persist invalid drafts",async()=>{
  const {update}=setup()
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  await userEvent.clear(screen.getByLabelText("Hours"))
  await userEvent.click(screen.getByRole("button",{name:"Save entry"}))
  expect(screen.getByRole("alert")).toHaveTextContent("non-negative hours")
  expect(update).not.toHaveBeenCalled()
})

it("keeps an active draft stable when another saved row refreshes",async()=>{
  const props={entries:[entry],onUpdate:vi.fn(),onStatusChange:vi.fn(),onDelete:vi.fn(),onClear:vi.fn()}
  const {rerender}=render(<EntriesLog {...props}/>)
  await userEvent.click(screen.getByRole("button",{name:"Edit entry"}))
  await userEvent.type(screen.getByLabelText("Description")," local")
  rerender(<EntriesLog {...props} entries={[{...entry,revision:"newer",description:"Remote edit"}]}/>)
  expect(screen.getByLabelText("Description")).toHaveValue("Documentation local")
  await userEvent.click(screen.getByRole("button",{name:"Save entry"}))
  expect(props.onUpdate).toHaveBeenCalledWith("one",expect.objectContaining({description:"Documentation local"}),"original")
})

it("locks a manager's own submitted row despite review privileges",()=>{
  setup({entries:[{...entry,status:"submitted"}],canReview:true})
  expect(screen.queryByRole("button",{name:"Edit entry"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Approve entry"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Reject entry"})).not.toBeInTheDocument()
})

it("keeps a failed review open with its reason and original evidence revision",async()=>{
  const transition=vi.fn().mockRejectedValue(new Error("Review access changed."))
  setup({entries:[{...entry,ownerEmail:"other@example.com",status:"submitted"}],canReview:true,onStatusChange:transition})
  await userEvent.click(screen.getByRole("button",{name:"Reject entry"}))
  const dialog=await screen.findByRole("dialog",{name:"Reject entry"})
  await userEvent.type(within(dialog).getByLabelText("Rejection reason"),"Incorrect hours")
  await userEvent.click(within(dialog).getByRole("button",{name:"Reject entry"}))
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Review access changed")
  expect(transition).toHaveBeenCalledWith("one","rejected","Incorrect hours","original")
  expect(within(dialog).getByLabelText("Rejection reason")).toHaveValue("Incorrect hours")
})

it("awaits approval and disables confirmation and navigation while saving",async()=>{
  let finish!:()=>void
  const transition=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}))
  setup({entries:[{...entry,ownerEmail:"other@example.com",status:"submitted"}],canReview:true,onStatusChange:transition})
  await userEvent.click(screen.getByRole("button",{name:"Approve entry"}))
  const dialog=await screen.findByRole("dialog",{name:"Approve entry"})
  await userEvent.click(within(dialog).getByRole("button",{name:"Approve entry"}))
  expect(within(dialog).getByRole("button",{name:"Approve entry"})).toBeDisabled()
  expect(within(dialog).getByRole("button",{name:"Back"})).toBeDisabled()
  expect(transition).toHaveBeenCalledOnce()
  await act(async()=>finish())
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("does not merge identical display names belonging to different owners",()=>{
  setup({entries:[entry,{...entry,id:"two",ownerEmail:"another@example.com",description:"Second task"}]})
  expect(screen.getAllByText("Person")).toHaveLength(2)
})

it("can hide the duplicate heading while keeping the timesheet controls visible",()=>{
  setup({hideHeader:true})
  expect(screen.queryByRole("heading",{name:"Time entries"})).not.toBeInTheDocument()
  expect(screen.getByRole("textbox",{name:"Search entries"})).toBeVisible()
  expect(screen.getByRole("table")).toBeVisible()
})

it("selects individual, matching, or all owned eligible entries without selecting others",async()=>{
  setup({canSubmit:true,entries:[entry,{...entry,id:"two",description:"Testing"},{...entry,id:"locked",status:"submitted"},{...entry,id:"other",ownerEmail:"other@example.com"}]})
  await userEvent.click(screen.getByText(/More controls/))
  expect(screen.getByText(/Bulk actions/)).toBeVisible()
  await userEvent.click(screen.getByRole("checkbox",{name:"Select entry one"}))
  expect(screen.getByRole("button",{name:"Submit selected (1)"})).toBeEnabled()
  expect(screen.getByRole("checkbox",{name:"Select entry locked"})).toBeDisabled()
  expect(screen.getByRole("checkbox",{name:"Select entry other"})).toBeDisabled()
  await userEvent.click(screen.getByRole("button",{name:"Select all eligible (2)"}))
  expect(screen.getByRole("button",{name:"Submit selected (2)"})).toBeEnabled()
  await userEvent.click(screen.getByRole("button",{name:"Clear selection"}))
  await userEvent.type(screen.getByRole("textbox",{name:"Search entries"}),"Testing")
  await userEvent.click(screen.getByRole("checkbox",{name:"Select all matching eligible entries"}))
  expect(screen.getByRole("button",{name:"Submit selected (1)"})).toBeEnabled()
  await userEvent.click(screen.getByRole("button",{name:"Select all eligible (2)"}))
  expect(screen.getByRole("button",{name:"Submit selected (2)"})).toBeEnabled()
})
