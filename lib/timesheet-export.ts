import type { TimeEntry } from "@/lib/types"
import type { TimesheetPdfView } from "@/lib/timesheet-pdf"

export type TimesheetExportFormat="csv"|"xlsx"|"ods"|"json"|"pdf-color"|"pdf-grayscale"

const fields=["Contractor","Date","Project","Description","Hours","Status"] as const

function recordRows(entries:TimeEntry[]):Array<Array<string|number>>{
  return entries.map(entry=>[entry.contractor,entry.date,entry.project,entry.description,Number(entry.hours)||0,entry.status])
}

function exportName(extension:string):string{
  return `timesheets-${new Date().toISOString().slice(0,10)}.${extension}`
}

function saveBlob(blob:Blob,filename:string):void{
  const url=URL.createObjectURL(blob)
  const link=document.createElement("a")
  link.href=url
  link.download=filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(entries:TimeEntry[]):void{
  const cell=(value:unknown)=>{
    const text=String(value??"")
    const safe=/^[\u0000-\u0020]*[=+\-@]/.test(text)?`'${text}`:text
    return `"${safe.replaceAll('"','""')}"`
  }
  const csv=[fields.map(cell).join(","),...recordRows(entries).map(row=>row.map(cell).join(","))].join("\r\n")
  saveBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),exportName("csv"))
}

function viewRows(view:TimesheetPdfView,entryCount:number):Array<[string,string|number]>{
  const rows:Array<[string,string|number]>=[["Entries",entryCount],["Period",view.period??"All entries"]]
  if(view.search)rows.push(["Search",view.search])
  if(view.status)rows.push(["Status",view.status])
  if(view.project)rows.push(["Project",view.project])
  if(view.dateFrom||view.dateThrough)rows.push(["Work dates",`${view.dateFrom||"any"} to ${view.dateThrough||"any"}`])
  if(view.sortBy)rows.push(["Sort",view.sortBy])
  if(view.groupBy)rows.push(["Group",view.groupBy])
  return rows
}

async function downloadXlsx(entries:TimeEntry[],view:TimesheetPdfView):Promise<void>{
  const ExcelJS=await import("exceljs")
  const workbook=new ExcelJS.Workbook()
  workbook.creator="Tanovo Time"
  workbook.created=new Date()
  const summary=workbook.addWorksheet("Summary")
  summary.addRows([["Timesheet export"],...viewRows(view,entries.length),["Total hours",entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0)]])
  summary.getRow(1).font={bold:true,size:16,color:{argb:"FF0F2D41"}}
  summary.getColumn(1).width=24
  summary.getColumn(2).width=58
  summary.getColumn(2).alignment={wrapText:true}

  const sheet=workbook.addWorksheet("Timesheets")
  sheet.addRow([...fields])
  for(const row of recordRows(entries))sheet.addRow(row)
  const totalRow=sheet.addRow(["TOTAL","","",`${entries.length} ${entries.length===1?"entry":"entries"}`,entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0),""])
  sheet.columns=[{width:24},{width:14},{width:26},{width:64},{width:12},{width:16}]
  sheet.views=[{state:"frozen",ySplit:1}]
  sheet.autoFilter={from:"A1",to:`F${Math.max(1,entries.length+1)}`}
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}}
  sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF174B65"}}
  sheet.getColumn(4).alignment={wrapText:true,vertical:"top"}
  sheet.getColumn(5).numFmt="0.##"
  totalRow.font={bold:true}
  totalRow.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFDCEAF1"}}
  const bytes=await workbook.xlsx.writeBuffer()
  saveBlob(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),exportName("xlsx"))
}

function escapeXml(value:string):string{
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;")
}

function odsCell(value:string|number):string{
  return typeof value==="number"
    ?`<table:table-cell office:value-type="float" office:value="${value}"/>`
    :`<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`
}

function odsTable(name:string,rows:Array<Array<string|number>>):string{
  return `<table:table table:name="${escapeXml(name)}">${rows.map(row=>`<table:table-row>${row.map(odsCell).join("")}</table:table-row>`).join("")}</table:table>`
}

async function downloadOds(entries:TimeEntry[],view:TimesheetPdfView):Promise<void>{
  const {strToU8,zipSync}=await import("fflate")
  const totals=entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0)
  const content=`<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:spreadsheet>${odsTable("Summary",[["Timesheet export"],...viewRows(view,entries.length),["Total hours",totals]])}${odsTable("Timesheets",[[...fields],...recordRows(entries),["TOTAL","","",`${entries.length} ${entries.length===1?"entry":"entries"}`,totals,""]])}</office:spreadsheet></office:body></office:document-content>`
  const manifest=`<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`
  const archive=zipSync({
    mimetype:[strToU8("application/vnd.oasis.opendocument.spreadsheet"),{level:0}],
    "content.xml":strToU8(content),
    "META-INF/manifest.xml":strToU8(manifest),
  })
  saveBlob(new Blob([archive],{type:"application/vnd.oasis.opendocument.spreadsheet"}),exportName("ods"))
}

export async function downloadTimesheetExport(entries:TimeEntry[],format:TimesheetExportFormat,view:TimesheetPdfView={}):Promise<void>{
  if(format==="csv"){downloadCsv(entries);return}
  if(format==="xlsx"){await downloadXlsx(entries,view);return}
  if(format==="ods"){await downloadOds(entries,view);return}
  if(format==="json"){
    const payload={generatedAt:new Date().toISOString(),view,entryCount:entries.length,totalHours:entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0),entries:entries.map(entry=>({contractor:entry.contractor,date:entry.date,project:entry.project,description:entry.description,hours:Number(entry.hours)||0,status:entry.status}))}
    saveBlob(new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"}),exportName("json"))
    return
  }
  const {downloadTimesheetPdf}=await import("@/lib/timesheet-pdf")
  await downloadTimesheetPdf(entries,{...view,colorMode:format==="pdf-color"?"color":"grayscale"})
}
