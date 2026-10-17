"use client"

import {useEffect} from "react"

/** Same-origin popup landing page; Azure continues to use the existing Auth.js callback URI. */
export default function ReauthenticationComplete(){
  useEffect(()=>{
    const state=new URL(window.location.href).searchParams.get("state")
    if(window.opener&&state&&/^[a-f0-9-]{36}$/i.test(state)){
      window.opener.postMessage({type:"tanovo:microsoft-reauth-complete",state,ok:!new URL(window.location.href).searchParams.has("error")},window.location.origin)
      window.close()
    }
  },[])
  return <main className="grid min-h-dvh place-items-center bg-slate-950 p-5 text-center text-white"><p role="status" className="max-w-sm text-sm">Microsoft verification complete. Returning to your workspace...</p></main>
}
