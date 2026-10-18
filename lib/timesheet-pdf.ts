import type { TimeEntry } from "@/lib/types"

export type TimesheetPdfView={
  period?:string
  search?:string
  status?:string
  project?:string
  dateFrom?:string
  dateThrough?:string
  sortBy?:string
  groupBy?:"project"|"day"|"person"|"none"
  colorMode?:"color"|"grayscale"
}

const sortLabels:Record<string,string>={
  date_newest:"Newest date",date_oldest:"Oldest date",project_az:"Project A-Z",
  person_az:"Person A-Z",hours_high:"Hours: high to low",hours_low:"Hours: low to high",status:"Status",
}

function groupDetails(entry:TimeEntry,groupBy:NonNullable<TimesheetPdfView["groupBy"]>):{key:string;label:string}{
  if(groupBy==="day")return {key:entry.date,label:`Day: ${entry.date}`}
  if(groupBy==="person")return {key:`${entry.contractor.toLocaleLowerCase()}\u0000${entry.ownerEmail?.toLocaleLowerCase()??entry.contractor.toLocaleLowerCase()}`,label:`Patron: ${entry.contractor}`}
  return {key:entry.project,label:`Project: ${entry.project}`}
}

function viewSummary(view:TimesheetPdfView):string{
  const details=[
    view.period&&`Period: ${view.period}`,
    view.search&&`Search: ${view.search}`,
    view.status&&`Status: ${view.status}`,
    view.project&&`Project: ${view.project}`,
    (view.dateFrom||view.dateThrough)&&`Work dates: ${view.dateFrom||"any"} to ${view.dateThrough||"any"}`,
    view.sortBy&&`Sort: ${sortLabels[view.sortBy]??view.sortBy}`,
    view.groupBy&&`Group: ${view.groupBy==="none"?"none":view.groupBy}`,
  ].filter(Boolean)
  return details.length?`Current view · ${details.join(" · ")}`:"Current view · All entries"
}

/** Builds a paginated PDF from entries already authorized and filtered in the current view. */
export async function createTimesheetPdf(entries:TimeEntry[],view:TimesheetPdfView={}):Promise<import("jspdf").jsPDF>{
  const [{jsPDF},{autoTable}]=await Promise.all([import("jspdf"),import("jspdf-autotable")])
  const pdf=new jsPDF({orientation:"landscape",unit:"pt",format:"a4",compress:true})
  const totalHours=entries.reduce((sum,entry)=>sum+(Number(entry.hours)||0),0)
  const generatedAt=new Date().toLocaleString()
  const margin=34
  const grayscale=view.colorMode==="grayscale"
  const palette={
    headerFill:grayscale?[232,232,232] as [number,number,number]:[225,239,247] as [number,number,number],
    headerText:grayscale?[20,20,20] as [number,number,number]:[15,45,65] as [number,number,number],
    alternateFill:grayscale?[248,248,248] as [number,number,number]:[248,251,253] as [number,number,number],
    line:grayscale?[175,175,175] as [number,number,number]:[190,200,210] as [number,number,number],
  }
  const contextLines=pdf.splitTextToSize(viewSummary(view),pdf.internal.pageSize.getWidth()-margin*2)
  const tableStart=58+contextLines.length*10
  const body:Array<Array<string|{content:string;colSpan:number;styles:{fillColor:[number,number,number];textColor:[number,number,number];fontStyle:"bold"}}>>=[]
  let previousGroup=""
  const groupTotals=new Map<string,{count:number;hours:number}>()
  if(view.groupBy&&view.groupBy!=="none")for(const entry of entries){
    const {key}=groupDetails(entry,view.groupBy)
    const total=groupTotals.get(key)??{count:0,hours:0}
    total.count+=1
    total.hours+=Number(entry.hours)||0
    groupTotals.set(key,total)
  }
  for(const entry of entries){
    if(view.groupBy&&view.groupBy!=="none"){
      const {key,label}=groupDetails(entry,view.groupBy)
      if(key!==previousGroup){
        const total=groupTotals.get(key)!
        body.push([{content:`${label}  ${total.count} ${total.count===1?"entry":"entries"} · ${total.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h`,colSpan:6,styles:{fillColor:palette.headerFill,textColor:palette.headerText,fontStyle:"bold"}}])
        previousGroup=key
      }
    }
    body.push([entry.contractor,entry.date,entry.project,entry.description,String(entry.hours),entry.status])
  }

  autoTable(pdf,{
    head:[["Contractor / employee","Date","Project","Description","Hours","Status"]],
    body,
    foot:[["TOTAL","","",`${entries.length} ${entries.length===1?"entry":"entries"}`,`${totalHours.toLocaleString(undefined,{maximumFractionDigits:2})}h`,""]],
    startY:tableStart,
    margin:{top:tableStart,right:margin,bottom:34,left:margin},
    tableWidth:"auto",
    showHead:"everyPage",
    showFoot:"lastPage",
    rowPageBreak:"avoid",
    theme:"grid",
    styles:{font:"helvetica",fontSize:8,cellPadding:5,overflow:"linebreak",valign:"top",textColor:[25,35,45],lineColor:palette.line,lineWidth:0.4},
    headStyles:{fillColor:palette.headerFill,textColor:palette.headerText,fontStyle:"bold",fontSize:8},
    footStyles:{fillColor:palette.headerFill,textColor:palette.headerText,fontStyle:"bold",lineColor:palette.line,lineWidth:0.7},
    alternateRowStyles:{fillColor:palette.alternateFill},
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
      pdf.text(contextLines,settings.margin.left,58)
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
export async function downloadTimesheetPdf(entries:TimeEntry[],view:TimesheetPdfView={}):Promise<void>{
  const pdf=await createTimesheetPdf(entries,view)
  const colorMode=view.colorMode??"color"
  pdf.save(`timesheets-${new Date().toISOString().slice(0,10)}-${colorMode}.pdf`)
}
