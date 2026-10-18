"use client"

import { useCallback,useEffect,useMemo,useState } from "react"
import { RefreshCw,Search,Users } from "lucide-react"
import { apiPath } from "@/lib/paths"
import { Button } from "@/components/ui/button"

type TeamMember={email:string;displayName:string;role:"employee"|"contractor";contractorNumber:string|null}

export function ManagerTeamDirectory(){
  const [people,setPeople]=useState<TeamMember[]>([])
  const [query,setQuery]=useState("")
  const [role,setRole]=useState<"all"|"employee"|"contractor">("all")
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  const load=useCallback(async()=>{
    setLoading(true);setError("")
    try{
      const response=await fetch(apiPath("/api/manager/team"),{cache:"no-store"})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Team directory is unavailable.")
      setPeople(Array.isArray(data.people)?data.people:[])
    }catch(cause){setError(cause instanceof Error?cause.message:"Team directory is unavailable.")}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{void load()},[load])
  const filtered=useMemo(()=>people.filter(person=>{
    const matchesRole=role==="all"||person.role===role
    const text=`${person.displayName} ${person.email} ${person.contractorNumber??""}`.toLowerCase()
    return matchesRole&&text.includes(query.trim().toLowerCase())
  }),[people,query,role])
  const employees=people.filter(person=>person.role==="employee").length
  const contractors=people.length-employees
  return <section aria-label="Team directory" className="min-w-0 overflow-hidden border-y border-blue-200 bg-white/80">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/60 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2"><Users className="size-4 shrink-0 text-blue-800"/><div><h3 className="text-xs font-semibold text-blue-950">My employees and contractors</h3><p className="text-[10px] text-slate-600">{employees} employees · {contractors} contractors assigned to you</p></div></div>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={()=>void load()} disabled={loading}><RefreshCw className={`size-3.5 ${loading?"animate-spin":""}`}/>Refresh directory</Button>
    </header>
    <div className="flex flex-wrap gap-1.5 border-b border-slate-200 p-2">
      <label className="relative min-w-0 flex-1 basis-52"><span className="sr-only">Search team directory</span><Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, email, or ID" className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs"/></label>
      <label className="sr-only" htmlFor="manager-team-role-filter">Filter team by role</label><select id="manager-team-role-filter" aria-label="Filter team by role" value={role} onChange={event=>setRole(event.target.value as typeof role)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">All roles ({people.length})</option><option value="employee">Employees ({employees})</option><option value="contractor">Contractors ({contractors})</option></select>
    </div>
    <div className="max-h-56 overflow-auto">
      {loading?<p role="status" className="px-3 py-4 text-xs text-slate-600">Loading assigned team…</p>:error?<p role="alert" className="px-3 py-3 text-xs text-red-800">{error}</p>:filtered.length?<table className="w-full min-w-[34rem] text-left text-xs"><thead className="sticky top-0 bg-sky-50 text-[10px] uppercase text-sky-950"><tr><th className="px-2.5 py-1.5 font-medium">Name</th><th className="px-2.5 py-1.5 font-medium">Role</th><th className="px-2.5 py-1.5 font-medium">Email</th><th className="px-2.5 py-1.5 font-medium">Employee / contractor ID</th></tr></thead><tbody>{filtered.map(person=><tr key={person.email} className="border-t border-slate-200 odd:bg-white even:bg-sky-50/30 hover:bg-sky-100"><td className="max-w-52 truncate px-2.5 py-2 font-medium" title={person.displayName||person.email}>{person.displayName||"Name not set"}</td><td className="px-2.5 py-2 capitalize">{person.role}</td><td className="px-2.5 py-2">{person.email}</td><td className="px-2.5 py-2 font-mono text-[11px]">{person.contractorNumber||"—"}</td></tr>)}</tbody></table>:<p className="px-3 py-4 text-xs text-slate-600">{people.length?"No team members match this search.":"No employees or contractors are currently assigned to you. Assign someone to one of your projects or to your review lane to add them here."}</p>}
    </div>
  </section>
}
