/**
 * Checks project grouping without collapsing distinct work records.
 * Both entries retain independent editing and submission controls.
 */
import { render,screen,within,waitFor,act,fireEvent,cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { EntriesLog } from "./entries-log"
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it("keeps multiple same-project work units as separate entries",()=>{
  const row={id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft" as const}
  render(<EntriesLog entries={[row,{...row,id:"two",hours:3,description:"Testing"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/>)
  expect(screen.getByText("Project: Project A · 2 entries · 5h")).toBeVisible()
  expect(screen.getAllByRole("button",{name:"Edit entry"})).toHaveLength(2)
  expect(screen.queryByRole("spinbutton",{name:"Hours"})).not.toBeInTheDocument()
  expect(screen.getAllByText("Person")).toHaveLength(1)
  expect(screen.getByText("Documentation")).toBeVisible()
  expect(screen.getByText("Testing")).toBeVisible()
})

it("exposes filtered CSV export only when the caller has the explicit export right",()=>{
  const onUpdate=vi.fn(),onStatusChange=vi.fn(),onDelete=vi.fn(),onClear=vi.fn()
  const props={entries:[entry],onUpdate,onStatusChange,onDelete,onClear}
  const {rerender}=render(<EntriesLog {...props}/> )
  expect(screen.queryByRole("button",{name:/export visible/i})).not.toBeInTheDocument()
  rerender(<EntriesLog {...props} canExport/> )
  expect(screen.getByRole("button",{name:"Export visible (1)"})).toBeEnabled()
})

it("filters timesheets by text, status, project and date, with selectable sort and grouping",async()=>{
  const user=userEvent.setup()
  const rows=[
    {id:"one",ownerEmail:"ann@example.com",contractor:"Ann",project:"Alpha",date:"2026-10-10",hours:2,description:"Design notes",status:"draft" as const},
    {id:"two",ownerEmail:"bo@example.com",contractor:"Bo",project:"Beta",date:"2026-10-12",hours:5,description:"Build release",status:"submitted" as const},
    {id:"three",ownerEmail:"cy@example.com",contractor:"Cy",project:"Beta",date:"2026-10-08",hours:3,description:"Test suite",status:"rejected" as const},
  ]
  render(<EntriesLog entries={rows} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/> )

  await user.type(screen.getByRole("textbox",{name:"Search entries"}),"Build release")
  expect(screen.getByText("Build release")).toBeVisible()
  expect(screen.queryByText("Design notes")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button",{name:"Reset timesheet view"}))

  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry project"}),"Beta")
  expect(screen.getByText("Project: Beta · 2 entries · 8h")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Sort entries"}),"hours_low")
  const rowTexts=screen.getAllByRole("row").map(row=>row.textContent??"")
  expect(rowTexts.findIndex(text=>text.includes("Test suite"))).toBeLessThan(rowTexts.findIndex(text=>text.includes("Build release")))

  await user.selectOptions(screen.getByRole("combobox",{name:"Group entries"}),"day")
  expect(screen.getByText(/Day: 2026-10-08/)).toBeVisible()
  fireEvent.change(screen.getByLabelText("Entries from date"),{target:{value:"2026-10-10"}})
  expect(screen.queryByText("Test suite")).not.toBeInTheDocument()
  expect(screen.getByText("Build release")).toBeVisible()
  await user.selectOptions(screen.getByRole("combobox",{name:"Filter entry status"}),"submitted")
  expect(screen.getByText("Showing 1 / 3")).toBeVisible()
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

it("requires confirmation before requesting a clear-all operation",async()=>{
  const onClear=vi.fn()
  const user=userEvent.setup()
  render(<EntriesLog entries={[{id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft"}]} canClear onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={onClear}/> )
  await user.click(screen.getByRole("button",{name:"Clear all"}))
  const dialog=await screen.findByRole("dialog",{name:"Confirm clearing timesheets"})
  expect(onClear).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole("button",{name:"Continue to Entra verification"}))
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

it("selects individual, matching, or all owned eligible entries without selecting others",async()=>{
  setup({canSubmit:true,entries:[entry,{...entry,id:"two",description:"Testing"},{...entry,id:"locked",status:"submitted"},{...entry,id:"other",ownerEmail:"other@example.com"}]})
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
