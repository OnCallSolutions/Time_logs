"use client"

import {useEffect,useState} from "react"
import {apiPath} from "@/lib/paths"

/** Starts Auth.js from the popup itself so OAuth cookies belong to its browsing context. */
export function ReauthenticationStart({state}:{state:string}){
  const [error,setError]=useState(false)

  useEffect(()=>{
    let active=true
    async function start():Promise<void>{
      try{
        if(!/^[a-f0-9-]{36}$/i.test(state))throw new Error("Invalid verification request.")
        const csrfResponse=await fetch(apiPath("/api/auth/csrf?stepup=1"),{cache:"no-store",signal:AbortSignal.timeout(15000)})
        if(!csrfResponse.ok)throw new Error("Verification could not start.")
        const {csrfToken}=await csrfResponse.json() as {csrfToken?:string}
        if(!csrfToken)throw new Error("Verification could not start.")

        // A normal document form navigation lets the browser persist transient
        // OAuth cookies in this popup before Microsoft redirects back to it.
        const form=document.createElement("form")
        form.method="POST"
        form.action=apiPath("/api/auth/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login")
        for(const [name,value] of Object.entries({
          csrfToken,
          callbackUrl:`${window.location.origin}${apiPath(`/reauth-complete?state=${encodeURIComponent(state)}`)}`,
        })){
          const input=document.createElement("input")
          input.type="hidden"
          input.name=name
          input.value=value
          form.appendChild(input)
        }
        document.body.appendChild(form)
        form.submit()
      }catch{
        if(!active)return
        setError(true)
        if(window.opener)window.opener.postMessage({type:"tanovo:microsoft-reauth-start-failed",state},window.location.origin)
      }
    }
    void start()
    return()=>{active=false}
  },[state])

  return <main className="grid min-h-dvh place-items-center bg-white p-6 text-center text-slate-900">
    <p role="status" className="max-w-sm text-sm">{error?"Microsoft verification could not start. Close this window and try again.":"Starting Microsoft verification…"}</p>
  </main>
}
