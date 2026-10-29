import {beforeEach,expect,it,vi} from "vitest"

const mocks=vi.hoisted(()=>({
  save:vi.fn(),setPage:vi.fn(),setFont:vi.fn(),setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),
  splitTextToSize:vi.fn((text:string)=>[text]),
  autoTable:vi.fn(),
  doc:{
    save:vi.fn(),setPage:vi.fn(),setFont:vi.fn(),setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),
    splitTextToSize:vi.fn((text:string)=>[text]),
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
    showFoot:"lastPage",
    foot:[["TOTAL","","","1 entry","2h",""]],
    rowPageBreak:"avoid",
    body:[["Patron","2026-10-18","Project","A detailed work record","2","submitted"]],
  }))
  expect(mocks.doc.setPage).toHaveBeenCalledTimes(2)
  expect(mocks.doc.text).toHaveBeenCalledWith("Page 1 of 2",808,579,{align:"right"})
  expect(mocks.doc.save).toHaveBeenCalledWith(expect.stringMatching(/^timesheets-\d{4}-\d{2}-\d{2}-color\.pdf$/))
})

it("retains long descriptions in the downloaded file's table data",async()=>{
  const description="Detailed evidence ".repeat(500)
  await downloadTimesheetPdf([{id:"long",contractor:"Patron",date:"2026-10-18",project:"Project",description,hours:2,status:"draft"}])
  expect(mocks.autoTable).toHaveBeenCalledWith(mocks.doc,expect.objectContaining({body:[["Patron","2026-10-18","Project",description,"2","draft"]]}))
})

it("prints the active view details and matching group totals with the filtered rows",async()=>{
  const entries=[
    {id:"one",contractor:"Patron",ownerEmail:"patron@example.com",date:"2026-10-18",project:"Alpha",description:"Visible",hours:2,status:"approved" as const},
    {id:"two",contractor:"Patron",ownerEmail:"patron@example.com",date:"2026-10-17",project:"Alpha",description:"Also visible",hours:3,status:"approved" as const},
  ]
  await downloadTimesheetPdf(entries,{
    period:"October 2026 (2026-10-01 to 2026-10-31)",search:"Patron",status:"approved",
    project:"Alpha",dateFrom:"2026-10-01",dateThrough:"2026-10-31",sortBy:"hours_high",groupBy:"project",
  })
  const {body,startY}=mocks.autoTable.mock.calls[0][1]
  expect(body).toEqual([
    [{content:"Project: Alpha  2 entries · 5h",colSpan:6,styles:{fillColor:[225,239,247],textColor:[15,45,65],fontStyle:"bold"}}],
    ["Patron","2026-10-18","Alpha","Visible","2","approved"],
    ["Patron","2026-10-17","Alpha","Also visible","3","approved"],
  ])
  expect(mocks.doc.splitTextToSize).toHaveBeenCalledWith(expect.stringContaining("Period: October 2026"),774)
  expect(startY).toBe(68)
  expect(mocks.autoTable.mock.calls[0][1].foot).toEqual([["TOTAL","","","2 entries","5h",""]])
})

it("uses neutral grayscale fills for a printer-friendly PDF",async()=>{
  const entry={id:"entry-1",contractor:"Patron",date:"2026-10-18",project:"Project",description:"Work",hours:2,status:"submitted" as const}
  await downloadTimesheetPdf([entry],{colorMode:"grayscale",groupBy:"project"})
  const options=mocks.autoTable.mock.calls[0][1]
  expect(options.headStyles.fillColor).toEqual([232,232,232])
  expect(options.alternateRowStyles.fillColor).toEqual([248,248,248])
  expect(options.body[0][0].styles.fillColor).toEqual([232,232,232])
  expect(mocks.doc.save).toHaveBeenCalledWith(expect.stringMatching(/^timesheets-\d{4}-\d{2}-\d{2}-grayscale\.pdf$/))
})
