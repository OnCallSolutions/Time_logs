"use client"

import { useState } from "react"
import { Download, FileJson2, FileSpreadsheet, FileText, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

type Row=Record<string,unknown>

function flatten(value:unknown):string|number|boolean|null{
  if(value===null||value===undefined)return ""
  if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value
  if(value instanceof Date)return value.toISOString()
  return JSON.stringify(value)
}

function save(blob:Blob,filename:string){
  const url=URL.createObjectURL(blob),link=document.createElement("a")
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

function printReport(title:string,fields:string[],rows:Record<string,string|number|boolean|null>[],summary?:Record<string,string|number>){
  const target=window.open("","_blank")
  if(!target)throw new Error("Allow pop-ups to print this report.")
  target.opener=null
  const escape=(value:unknown)=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")
  const summaryMarkup=Object.entries(summary??{}).map(([key,value])=>`<span><b>${escape(key)}:</b> ${escape(value)}</span>`).join("")
  const header=fields.map(field=>`<th>${escape(field)}</th>`).join("")
  const body=rows.map(row=>`<tr>${fields.map(field=>`<td>${escape(row[field])}</td>`).join("")}</tr>`).join("")
  target.document.open()
  target.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page{size:landscape;margin:12mm}*{box-sizing:border-box}body{font:10px/1.35 Arial,sans-serif;color:#111;margin:0}h1{font-size:18px;margin:0 0 5px}p{color:#555;margin:0 0 12px}.summary{display:flex;flex-wrap:wrap;gap:6px 16px;border-block:1px solid #aaa;padding:7px 0;margin-bottom:10px}table{width:100%;border-collapse:collapse;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #999;padding:4px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8edf2;font-weight:700}td{max-width:240px}footer{margin-top:10px;color:#555;font-size:9px}@media print{a{color:inherit}}
  </style></head><body><h1>${escape(title)}</h1><p>Generated ${escape(new Date().toLocaleString())} · ${rows.length} rows</p>${summaryMarkup?`<div class="summary">${summaryMarkup}</div>`:""}<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table><footer>Tanovo Time</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));window.addEventListener('afterprint',()=>window.close());</script></body></html>`)
  target.document.close()
}

function pdfColumnWeight(field:string):number{
  const name=field.toLowerCase()
  if(/description|metadata|details|message|reason|path/.test(name))return 1.8
  if(/date|time|actor|person|email|contractor|employee|id|request/.test(name))return 1.25
  return 1
}

function formatPdfValue(field:string,value:unknown):string{
  if(value===null||value===undefined)return ""
  if(typeof value==="object")return JSON.stringify(value)
  const text=typeof value==="string"?value:String(value)
  if(/^(occurredat|createdat|updatedat|timestamp)$/i.test(field)&&!Number.isNaN(Date.parse(text))){
    return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(text))
  }
  return text
}

function preparePdfTable(fields:string[],rows:Row[],normalized:Record<string,string|number|boolean|null>[]){
  const auditReport=fields.includes("occurredAt")&&fields.includes("actor")&&fields.includes("targetType")&&fields.includes("requestPath")
  if(!auditReport)return {
    headers:fields.map(field=>field.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,letter=>letter.toUpperCase())),
    body:normalized.map(row=>fields.map(field=>formatPdfValue(field,row[field]))),
    weights:fields.map(pdfColumnWeight),
  }

  return {
    headers:["Date / time","Actor","Action","Target","Request","Details"],
    body:rows.map(row=>[
      formatPdfValue("occurredAt",row.occurredAt),
      formatPdfValue("actor",row.actor),
      formatPdfValue("action",row.action),
      [`Record: ${formatPdfValue("targetType",row.targetType)}`,row.targetId?`ID: ${formatPdfValue("targetId",row.targetId)}`:""].filter(Boolean).join("\n"),
      [`${[formatPdfValue("requestMethod",row.requestMethod),formatPdfValue("requestPath",row.requestPath)].filter(Boolean).join(" ")}`,row.requestId?`Request ID: ${formatPdfValue("requestId",row.requestId)}`:""].filter(Boolean).join("\n"),
      formatPdfValue("metadata",row.metadata),
    ]),
    weights:[1.2,1.15,1,1.35,1.8,1.5],
  }
}

/** Export exactly the rows supplied by a page, which should already reflect its filters and sort. */
export function DataExportMenu({rows,title,filename="report",summary}: {rows:Row[];title:string;filename?:string;summary?:Record<string,string|number>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[menuOpen,setMenuOpen]=useState(false)
  const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))]
  const normalized=rows.map(row=>Object.fromEntries(fields.map(field=>[field,flatten(row[field])])))
  async function exportAs(format:"csv"|"json"|"xlsx"|"pdf"){
    if(!rows.length)return
    setBusy(true);setError("")
    try{
      const date=new Date().toISOString().slice(0,10),base=`${filename}-${date}`
      if(format==="json")save(new Blob([JSON.stringify({title,generatedAt:new Date().toISOString(),summary,rows:normalized},null,2)],{type:"application/json;charset=utf-8"}),`${base}.json`)
      if(format==="csv"){
        const cell=(value:unknown)=>{const text=String(value??"");return `"${(/^[\u0000-\u0020]*[=+\-@]/.test(text)?`'${text}`:text).replaceAll('"','""')}"`}
        const lines=[fields.map(cell).join(","),...normalized.map(row=>fields.map(field=>cell(row[field])).join(","))]
        save(new Blob(["\uFEFF",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),`${base}.csv`)
      }
      if(format==="xlsx"){
        const ExcelJS=await import("exceljs"),workbook=new ExcelJS.Workbook(),overview=workbook.addWorksheet("Export summary"),sheet=workbook.addWorksheet("Current view")
        workbook.creator="Tanovo Time";overview.addRows([[title],["Generated at",new Date().toLocaleString()],...Object.entries(summary??{}).map(([key,value])=>[key,value])])
        overview.getRow(1).font={bold:true,size:16,color:{argb:"FF0F2D41"}};overview.getColumn(1).width=28;overview.getColumn(2).width=56
        sheet.addRow(fields)
        normalized.forEach(row=>sheet.addRow(fields.map(field=>row[field])))
        sheet.columns=fields.map(field=>({header:field,key:field,width:Math.min(42,Math.max(14,field.length+4))}))
        sheet.views=[{state:"frozen",ySplit:1}];sheet.autoFilter={from:"A1",to:`${String.fromCharCode(64+Math.min(fields.length,26))}${Math.max(1,rows.length+1)}`}
        sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF174B65"}}
        sheet.eachRow(row=>{row.alignment={vertical:"top",wrapText:true}})
        const bytes=await workbook.xlsx.writeBuffer();save(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`${base}.xlsx`)
      }
      if(format==="pdf"){
        const {jsPDF}=await import("jspdf"),{default:autoTable}=await import("jspdf-autotable")
        const doc=new jsPDF({orientation:"landscape",unit:"pt",format:"a4"})
        const margin=36,pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight(),usableWidth=pageWidth-margin*2
        doc.setFontSize(15);doc.text(title,margin,34);doc.setFontSize(9)
        const meta=summary?Object.entries(summary).map(([key,value])=>`${key}: ${value}`).join("   ·   "):``
        if(meta)doc.text(meta,margin,50,{maxWidth:usableWidth})
        const table=preparePdfTable(fields,rows,normalized),weightTotal=table.weights.reduce((sum,weight)=>sum+weight,0)
        const columnStyles=Object.fromEntries(table.weights.map((weight,index)=>[index,{cellWidth:usableWidth*weight/weightTotal}]))
        autoTable(doc,{
          startY:meta?65:52,
          head:[table.headers],
          body:table.body,
          margin:{top:42,left:margin,right:margin,bottom:32},
          columnStyles,
          styles:{fontSize:7,cellPadding:3,overflow:"linebreak",valign:"top"},
          headStyles:{fillColor:[23,75,101]},
          showHead:"everyPage",
          didDrawPage:({pageNumber})=>{
            if(pageNumber>1){doc.setFontSize(8);doc.setTextColor(70);doc.text(title,margin,22)}
          },
        })
        const pageCount=doc.getNumberOfPages()
        for(let page=1;page<=pageCount;page++){
          doc.setPage(page);doc.setFontSize(7);doc.setTextColor(90)
          doc.text(`Page ${page} of ${pageCount}`,pageWidth-margin,pageHeight-14,{align:"right"})
        }
        doc.save(`${base}.pdf`)
      }
    }catch{setError("Could not prepare this export. Please try again.")}
    finally{setBusy(false)}
  }
  const choose=(format:"csv"|"json"|"xlsx"|"pdf")=>{setMenuOpen(false);void exportAs(format)}
  return <div className="relative flex items-center gap-1">
    <Button type="button" variant="outline" size="sm" aria-label={`Export ${title}`} title="Export current filtered view" className="h-8" aria-expanded={menuOpen} onClick={()=>setMenuOpen(open=>!open)}><Download className="size-3.5"/>Export <span className="text-slate-500">({rows.length})</span></Button>
    {menuOpen&&<div role="menu" aria-label={`${title} export options`} className="absolute right-0 top-full z-50 mt-1 grid min-w-52 gap-1 border border-slate-200 bg-white p-1.5 shadow-lg">
        <p className="px-2 py-1 text-[11px] font-medium text-slate-600">Download current filtered view · {rows.length} rows</p>
        <button type="button" role="menuitem" disabled={!rows.length||busy} onClick={()=>choose("xlsx")} className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-50"><FileSpreadsheet className="size-4"/>Download Excel (.xlsx)</button>
        <button type="button" role="menuitem" disabled={!rows.length||busy} onClick={()=>choose("csv")} className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-50"><FileSpreadsheet className="size-4"/>Download CSV (.csv)</button>
        <button type="button" role="menuitem" disabled={!rows.length||busy} onClick={()=>choose("json")} className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-50"><FileJson2 className="size-4"/>Download JSON (.json)</button>
        <button type="button" role="menuitem" disabled={!rows.length||busy} onClick={()=>choose("pdf")} className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-50"><FileText className="size-4"/>Download PDF (.pdf)</button>
        <button type="button" role="menuitem" disabled={!rows.length} onClick={()=>{setMenuOpen(false);try{printReport(title,fields,normalized,summary)}catch(error){setError(error instanceof Error?error.message:"Could not open print preview.")}}} className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-sky-50 disabled:opacity-50"><Printer className="size-4"/>Print report</button>
      </div>}
    {busy&&<span role="status" className="text-xs text-slate-600">Preparing…</span>}
    {error&&<span role="alert" className="text-xs text-red-700">{error}</span>}
  </div>
}
