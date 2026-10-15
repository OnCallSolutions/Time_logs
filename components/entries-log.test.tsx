/**
 * Checks project grouping without collapsing distinct work records.
 * Both entries retain independent editing and submission controls.
 */
import { render,screen,within,waitFor,act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect,it,vi } from "vitest"
import { EntriesLog } from "./entries-log"
it("keeps multiple same-project work units as separate entries",()=>{
  const row={id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft" as const}
  render(<EntriesLog entries={[row,{...row,id:"two",hours:3,description:"Testing"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/>)
  expect(screen.getByText("Project: Project A / 2 entries / 5h")).toBeVisible()
  expect(screen.getAllByRole("button",{name:"Edit entry"})).toHaveLength(2)
  expect(screen.queryByRole("spinbutton",{name:"Hours"})).not.toBeInTheDocument()
  expect(screen.getAllByText("Person")).toHaveLength(1)
  expect(screen.getByText("Documentation")).toBeVisible()
  expect(screen.getByText("Testing")).toBeVisible()
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
