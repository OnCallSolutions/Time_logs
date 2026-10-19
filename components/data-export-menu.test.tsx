import {render,screen,waitFor} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {expect,it,vi} from "vitest"

const mocks=vi.hoisted(()=>{
  const doc={
    internal:{pageSize:{getWidth:()=>841.89,getHeight:()=>595.28}},
    setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),setPage:vi.fn(),getNumberOfPages:vi.fn(()=>2),save:vi.fn(),
  }
  return {doc,autoTable:vi.fn((_doc:unknown,_options:Record<string,unknown>)=>undefined)}
})

vi.mock("jspdf",()=>({jsPDF:vi.fn(function(){return mocks.doc})}))
vi.mock("jspdf-autotable",()=>({default:mocks.autoTable}))
import {DataExportMenu} from "./data-export-menu"

it("keeps wide report PDFs on a fitted table and repeats useful page context",async()=>{
  const user=userEvent.setup()
  render(<DataExportMenu title="App activity" filename="activity" summary={{period:"October 2026"}} rows={[{
    occurredAt:"2026-10-19T18:12:17.580Z",actor:"manager@example.com",action:"entry approved",targetType:"time_entry",targetId:"123e4567-e89b-42d3-a456-426614174000",requestMethod:"PATCH",requestPath:"/api/entries/123e4567-e89b-42d3-a456-426614174000",requestId:"123e4567-e89b-42d3-a456-426614174000",metadata:{beforeStatus:"submitted",afterStatus:"approved"},
  }]}/>)
  await user.click(screen.getByRole("button",{name:"Export App activity"}))
  await user.click(screen.getByRole("menuitem",{name:"Download PDF (.pdf)"}))
  await waitFor(()=>expect(mocks.autoTable).toHaveBeenCalled())

  const options=mocks.autoTable.mock.calls[0][1] as {
    horizontalPageBreak?:boolean
    showHead:string
    head:string[][]
    body:string[][]
    columnStyles:Record<string,{cellWidth:number}>
    didDrawPage:unknown
  }
  expect(options.horizontalPageBreak).toBeUndefined()
  expect(options.showHead).toBe("everyPage")
  expect(options.head[0]).toEqual(["Date / time","Actor","Action","Target","Request","Details"])
  expect(Object.values(options.columnStyles).reduce((sum,style)=>sum+style.cellWidth,0)).toBeCloseTo(841.89-72,1)
  expect(options.body[0][0]).not.toBe("2026-10-19T18:12:17.580Z")
  expect(options.body[0][3]).toContain("ID: 123e4567-e89b-42d3-a456-426614174000")
  expect(options.body[0][4]).toContain("PATCH /api/entries/123e4567-e89b-42d3-a456-426614174000")
  expect(options.body[0][5]).toContain('"beforeStatus":"submitted"')
  expect(options.didDrawPage).toBeTypeOf("function")
  expect(mocks.doc.save).toHaveBeenCalledWith("activity-"+new Date().toISOString().slice(0,10)+".pdf")
  expect(mocks.doc.text).toHaveBeenCalledWith("Page 2 of 2",841.89-36,595.28-14,{align:"right"})
})
