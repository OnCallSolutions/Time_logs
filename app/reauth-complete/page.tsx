"use client"

import {useEffect} from "react"
import {apiPath} from "@/lib/paths"

/** Same-origin popup landing page; Azure continues to use the existing Auth.js callback URI. */
export default function ReauthenticationComplete(){
  useEffect(()=>{
    let active=true
    const finish=async()=>{
      const url=new URL(window.location.href),state=url.searchParams.get("state")
      if(!window.opener||!state||!/^[a-f0-9-]{36}$/i.test(state))return
      let ok=!url.searchParams.has("error")
      if(ok){
        try{const response=await fetch(apiPath("/api/access-reauth/complete"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state}),cache:"no-store"});ok=response.ok}catch{ok=false}
      }
      if(!active)return
      window.opener.postMessage({type:"tanovo:microsoft-reauth-complete",state,ok},window.location.origin)
      window.close()
    }
    void finish()
    return()=>{active=false}
  },[])
  return <main className="grid min-h-dvh place-items-center bg-slate-950 p-5 text-center text-white"><p role="status" className="max-w-sm text-sm">Verifying your identity for this change…</p></main>
}
