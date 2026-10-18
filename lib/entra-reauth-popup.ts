import { apiPath } from "@/lib/paths"

/** Opens the existing Entra provider flow in a small popup without navigating the workspace. */
export function openEntraReauthentication(state:string,onFailure:()=>void):Window|null{
  const popup=window.open("about:blank","tanovo-microsoft-step-up","popup,width=380,height=500,resizable=yes,scrollbars=yes")
  if(!popup)return null
  const redirectTo=`${window.location.origin}${apiPath(`/reauth-complete?state=${encodeURIComponent(state)}`)}`
  void (async()=>{
    const base=apiPath("/api/auth")
    const csrfResponse=await fetch(`${base}/csrf?stepup=1`,{cache:"no-store"})
    if(!csrfResponse.ok)throw new Error("Microsoft verification could not start.")
    const {csrfToken}=await csrfResponse.json() as {csrfToken?:string}
    if(!csrfToken)throw new Error("Microsoft verification could not start.")
    const response=await fetch(`${base}/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded","X-Auth-Return-Redirect":"1"},
      body:new URLSearchParams({csrfToken,callbackUrl:redirectTo}),
      cache:"no-store",
    })
    const result=await response.json() as {url?:string}
    if(!response.ok||!result.url)throw new Error("Microsoft verification could not start.")
    popup.location.href=result.url
  })().catch(()=>{popup.close();onFailure()})
  return popup
}
