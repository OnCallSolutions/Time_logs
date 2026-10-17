"use client"

import { useEffect, useState } from "react"
import { CalendarClock, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type Period={id:string;name:string;startDate:string;endDate:string}

/** Warns period managers before a missing successor needs a default schedule. */
export function PeriodExpirationNotice({onManage}:{onManage:()=>void}){
  const [period,setPeriod]=useState<Period|null>(null)
  const [daysLeft,setDaysLeft]=useState<number|null>(null)
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Periods unavailable")
      const periods=Array.isArray(data.periods)?data.periods as Period[]:[]
      const today=new Date().toISOString().slice(0,10)
      const current=periods.find(item=>item.startDate<=today&&item.endDate>=today)
      if(!current)return
      const future=periods.some(item=>item.startDate>current.endDate)
      if(future)return
      const start=new Date(`${today}T00:00:00.000Z`)
      const end=new Date(`${current.endDate}T00:00:00.000Z`)
      const days=Math.ceil((end.getTime()-start.getTime())/86400000)
      if(days<=14){setPeriod(current);setDaysLeft(days)}
    }).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[])
  if(loading||!period)return null
  const expired=daysLeft!==null&&daysLeft<0
  return <aside aria-label="Timesheet period expiration" className={`flex flex-wrap items-center justify-between gap-3 border-l-4 px-3 py-2 ${daysLeft!==null&&daysLeft<=3?"border-red-600 bg-red-50":"border-orange-500 bg-orange-50"}`}>
    <div className="flex min-w-0 items-start gap-2"><CalendarClock className={`mt-0.5 size-4 shrink-0 ${daysLeft!==null&&daysLeft<=3?"text-red-700":"text-orange-700"}`}/><div><h2 className={`text-sm font-semibold ${daysLeft!==null&&daysLeft<=3?"text-red-950":"text-orange-950"}`}>{expired?"Timesheet period has expired":`“${period.name}” ends ${daysLeft===0?"today":`in ${daysLeft} days`}`}</h2><p className="text-xs text-slate-700">Set the next period now. If left unchanged, the system will schedule a four-week period from the next Saturday through Friday.</p></div></div>
    <Button type="button" size="sm" variant="outline" onClick={onManage} className="shrink-0 border-orange-300 bg-white text-orange-950 hover:bg-orange-100">Set next period<ChevronRight className="size-4"/></Button>
  </aside>
}
