import {expect,it,vi} from "vitest"
import type {TimeEntry} from "@/lib/types"
import {createTimesheetPdf} from "./timesheet-pdf"

it("renders many timesheet rows across PDF pages and triggers a direct download",async()=>{
  const entries:TimeEntry[]=Array.from({length:80},(_,index)=>({
    id:`entry-${index}`,contractor:`Patron ${index%8}`,date:`2026-10-${String(index%28+1).padStart(2,"0")}`,
    project:`Project ${index%5}`,description:`Work detail ${index}. `.repeat(12),hours:1.5,status:"submitted",
  }))

  const generated=await createTimesheetPdf(entries)

  expect(generated.getNumberOfPages()).toBeGreaterThan(1)
  const save=vi.spyOn(generated,"save").mockImplementation(()=>generated)
  generated.save("timesheets-test.pdf")
  expect(save).toHaveBeenCalledWith("timesheets-test.pdf")
})
