import type { TimeEntry } from "@/lib/types"

/** Builds a paginated PDF from entries already authorized and filtered in the current view. */
export async function createTimesheetPdf(entries:TimeEntry[]):Promise<import("jspdf").jsPDF>{
  const [{jsPDF},{autoTable}]=await Promise.all([import("jspdf"),import("jspdf-autotable")])
  const pdf=new jsPDF({orientation:"landscape",unit:"pt",format:"a4",compress:true})
  const totalHours=entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0)
  const generatedAt=new Date().toLocaleString()
  const margin=34

  autoTable(pdf,{
    head:[["Contractor / employee","Date","Project","Description","Hours","Status"]],
    body:entries.map(entry=>[entry.contractor,entry.date,entry.project,entry.description,String(entry.hours),entry.status]),
    startY:70,
    margin:{top:70,right:margin,bottom:34,left:margin},
    tableWidth:"auto",
    showHead:"everyPage",
    rowPageBreak:"avoid",
    theme:"grid",
    styles:{font:"helvetica",fontSize:8,cellPadding:5,overflow:"linebreak",valign:"top",textColor:[25,35,45],lineColor:[190,200,210],lineWidth:0.4},
    headStyles:{fillColor:[225,239,247],textColor:[15,45,65],fontStyle:"bold",fontSize:8},
    alternateRowStyles:{fillColor:[248,251,253]},
    columnStyles:{0:{cellWidth:115},1:{cellWidth:78},2:{cellWidth:130},3:{cellWidth:"auto"},4:{cellWidth:48,halign:"right"},5:{cellWidth:65}},
    didDrawPage:({settings})=>{
      pdf.setFont("helvetica","bold")
      pdf.setFontSize(15)
      pdf.setTextColor(20,35,50)
      pdf.text("Timesheet export",settings.margin.left,30)
      pdf.setFont("helvetica","normal")
      pdf.setFontSize(8)
      pdf.setTextColor(75,85,95)
      pdf.text(`${entries.length} ${entries.length===1?"entry":"entries"}  |  ${totalHours} total hours  |  Generated ${generatedAt}`,settings.margin.left,47)
    },
  })

  const pageCount=pdf.getNumberOfPages()
  for(let page=1;page<=pageCount;page++){
    pdf.setPage(page)
    pdf.setFont("helvetica","normal")
    pdf.setFontSize(8)
    pdf.setTextColor(90,100,110)
    pdf.text(`Page ${page} of ${pageCount}`,pdf.internal.pageSize.getWidth()-margin, pdf.internal.pageSize.getHeight()-16,{align:"right"})
  }
  return pdf
}

/** Generates the selected timesheet records as a directly downloaded PDF file. */
export async function downloadTimesheetPdf(entries:TimeEntry[]):Promise<void>{
  const pdf=await createTimesheetPdf(entries)
  pdf.save(`timesheets-${new Date().toISOString().slice(0,10)}.pdf`)
}
