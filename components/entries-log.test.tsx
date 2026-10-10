/**
 * Checks project grouping without collapsing distinct work records.
 * Both entries retain independent editing and submission controls.
 */
import { render,screen } from "@testing-library/react"
import { expect,it,vi } from "vitest"
import { EntriesLog } from "./entries-log"
it("keeps multiple same-project work units as separate entries",()=>{
  const row={id:"one",contractor:"Person",project:"Project A",date:"2026-10-10",hours:2,description:"Documentation",status:"draft" as const}
  render(<EntriesLog entries={[row,{...row,id:"two",hours:3,description:"Testing"}]} onUpdate={vi.fn()} onStatusChange={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/>)
  expect(screen.getByText("Project: Project A / 2 entries / 5h")).toBeVisible()
  expect(screen.getAllByRole("spinbutton",{name:"Hours"})).toHaveLength(2)
})
