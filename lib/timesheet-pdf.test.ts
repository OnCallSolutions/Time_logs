import {beforeEach,expect,it,vi} from "vitest"

const mocks=vi.hoisted(()=>({
  save:vi.fn(),setPage:vi.fn(),setFont:vi.fn(),setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),
  autoTable:vi.fn(),
  doc:{
    save:vi.fn(),setPage:vi.fn(),setFont:vi.fn(),setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),
    getNumberOfPages:vi.fn(()=>2),internal:{pageSize:{getWidth:()=>842,getHeight:()=>595}},
  },
}))
vi.mock("jspdf",()=>({jsPDF:vi.fn(function(){return mocks.doc})}))
vi.mock("jspdf-autotable",()=>({autoTable:mocks.autoTable}))
import {downloadTimesheetPdf} from "./timesheet-pdf"

beforeEach(()=>{
  vi.clearAllMocks()
  mocks.doc.getNumberOfPages.mockReturnValue(2)
})

it("downloads a landscape multi-page PDF with repeated headers and page numbers",async()=>{
  const entry={id:"entry-1",contractor:"Patron",date:"2026-10-18",project:"Project",description:"A detailed work record",hours:2,status:"submitted" as const}
  await downloadTimesheetPdf([entry])

  const {jsPDF}=await import("jspdf")
  expect(jsPDF).toHaveBeenCalledWith({orientation:"landscape",unit:"pt",format:"a4",compress:true})
  expect(mocks.autoTable).toHaveBeenCalledWith(mocks.doc,expect.objectContaining({
    showHead:"everyPage",
    rowPageBreak:"avoid",
    body:[["Patron","2026-10-18","Project","A detailed work record","2","submitted"]],
  }))
  expect(mocks.doc.setPage).toHaveBeenCalledTimes(2)
  expect(mocks.doc.text).toHaveBeenCalledWith("Page 1 of 2",808,579,{align:"right"})
  expect(mocks.doc.save).toHaveBeenCalledWith(expect.stringMatching(/^timesheets-\d{4}-\d{2}-\d{2}\.pdf$/))
})

it("retains long descriptions in the downloaded file's table data",async()=>{
  const description="Detailed evidence ".repeat(500)
  await downloadTimesheetPdf([{id:"long",contractor:"Patron",date:"2026-10-18",project:"Project",description,hours:2,status:"draft"}])
  expect(mocks.autoTable).toHaveBeenCalledWith(mocks.doc,expect.objectContaining({body:[["Patron","2026-10-18","Project",description,"2","draft"]]}))
})
