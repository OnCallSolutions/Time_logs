"use client"

import { useEffect, useState } from "react"
import { CalendarClock } from "lucide-react"
import { apiPath } from "@/lib/paths"

type Period={id:string;name:string;startDate:string;endDate:string;submissionDeadline:string}

/** Shows every signed-in patron the active or next period's precise submission boundary. */
export function SubmissionDeadlineNotice(){
  const [period,setPeriod]=useState<Period|null>(null)
  const [legacyDeadline,setLegacyDeadline]=useState<string|null>(null)
  const [loaded,setLoaded]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error("Period lookup failed")
      const periods=Array.isArray(data.periods)?data.periods as Period[]:[]
      const today=new Date().toISOString().slice(0,10)
      const selected=periods.find(item=>item.startDate<=today&&item.endDate>=today)
        ??periods.filter(item=>item.startDate>today).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0]
      setPeriod(selected??null)
      if(!periods.length){
        const boundary=await fetch(apiPath("/api/submission-deadline"),{cache:"no-store",signal:controller.signal})
        if(boundary.ok){const value=await boundary.json();setLegacyDeadline(value.deadline??null)}
      }
    }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoaded(true)})
    return()=>controller.abort()
  },[])
  if(!loaded)return null
  const deadline=period?.submissionDeadline??legacyDeadline
  const expired=!!deadline&&Date.parse(deadline)<=Date.now()
  const label=deadline?new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(deadline)):null
  const tone=expired?"border-red-300 bg-red-50 text-red-950":deadline?"border-orange-200 bg-orange-50/80 text-orange-950":"border-sky-200 bg-sky-50/80 text-sky-950"
  return <aside aria-label="Timesheet submission deadline" className={`flex min-w-0 items-center gap-2 border-b px-3 py-1.5 text-xs ${tone}`}>
    <CalendarClock aria-hidden="true" className="size-3.5 shrink-0"/>
    <p className="min-w-0 truncate">{deadline?`${period?.name?`${period.name} · `:""}Submit by ${label}${expired?" · deadline passed":""}`:"No timesheet submission deadline is configured."}</p>
  </aside>
}
