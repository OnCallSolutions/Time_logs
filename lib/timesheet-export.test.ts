import {afterEach,beforeEach,expect,it,vi} from "vitest"
import {unzipSync,strFromU8} from "fflate"
import type {TimeEntry} from "@/lib/types"
import {downloadTimesheetExport} from "./timesheet-export"

let exportedBlob:Blob
let createdUrl:ReturnType<typeof vi.fn>
let lastLink:HTMLAnchorElement|undefined

beforeEach(()=>{
  createdUrl=vi.fn((blob:Blob)=>{exportedBlob=blob;return "blob:timesheet-export"})
  vi.stubGlobal("URL",{createObjectURL:createdUrl,revokeObjectURL:vi.fn()})
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){lastLink=this})
  lastLink=undefined
})

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

const entry:TimeEntry={id:"entry-1",contractor:"Patron",date:"2026-10-18",project:"Alpha",description:"Design & delivery",hours:2.5,status:"approved"}
const view={period:"October 2026",status:"approved",groupBy:"project" as const}

it("downloads valid XLSX with a summary and the currently visible rows",async()=>{
  await downloadTimesheetExport([entry],"xlsx",view)
  const imported=await import("exceljs")
  const workbook=new imported.Workbook()
  await workbook.xlsx.load(await exportedBlob.arrayBuffer())
  expect(workbook.worksheets.map(sheet=>sheet.name)).toEqual(["Summary","Timesheets"])
  expect(workbook.getWorksheet("Summary")?.getCell("B3").value).toBe("October 2026")
  expect(workbook.getWorksheet("Timesheets")?.getRow(2).values).toContain("Design & delivery")
  expect(workbook.getWorksheet("Timesheets")?.getRow(3).values).toContain(2.5)
  expect(lastLink?.download).toMatch(/\.xlsx$/)
})

it("downloads a valid ODS archive with view summary and filtered entries",async()=>{
  await downloadTimesheetExport([entry],"ods",view)
  const files=unzipSync(new Uint8Array(await exportedBlob.arrayBuffer()))
  expect(Object.keys(files)[0]).toBe("mimetype")
  expect(strFromU8(files.mimetype)).toBe("application/vnd.oasis.opendocument.spreadsheet")
  const xml=strFromU8(files["content.xml"])
  expect(xml).toContain("table:name=\"Summary\"")
  expect(xml).toContain("October 2026")
  expect(xml).toContain("Design &amp; delivery")
  expect(xml).toContain("2.5")
  expect(lastLink?.download).toMatch(/\.ods$/)
})

it("downloads structured JSON with export metadata and data records",async()=>{
  await downloadTimesheetExport([entry],"json",view)
  const payload=JSON.parse(await exportedBlob.text())
  expect(payload).toMatchObject({entryCount:1,totalHours:2.5,view:{period:"October 2026",status:"approved"}})
  expect(payload.entries).toEqual([{contractor:"Patron",date:"2026-10-18",project:"Alpha",description:"Design & delivery",hours:2.5,status:"approved"}])
  expect(lastLink?.download).toMatch(/\.json$/)
})
