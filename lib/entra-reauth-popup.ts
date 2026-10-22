import { apiPath } from "@/lib/paths"

/** Opens the existing Entra provider flow in a small popup without navigating the workspace. */
export function openEntraReauthentication(state:string,onFailure:()=>void):Window|null{
  const width=380,height=500
  const outerWidth=Number.isFinite(window.outerWidth)&&window.outerWidth>0?window.outerWidth:window.innerWidth
  const outerHeight=Number.isFinite(window.outerHeight)&&window.outerHeight>0?window.outerHeight:window.innerHeight
  const left=Math.round((Number.isFinite(window.screenX)?window.screenX:0)+Math.max(0,(outerWidth-width)/2))
  const top=Math.round((Number.isFinite(window.screenY)?window.screenY:0)+Math.max(0,(outerHeight-height)/2))
  const popup=window.open("about:blank","tanovo-microsoft-step-up",`popup,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`)
  if(!popup)return null
  const redirectTo=`${window.location.origin}${apiPath(`/reauth-complete?state=${encodeURIComponent(state)}`)}`
  void (async()=>{
    const base=apiPath("/api/auth")
    const csrfResponse=await fetch(`${base}/csrf?stepup=1`,{cache:"no-store"})
    if(!csrfResponse.ok)throw new Error("Microsoft verification could not start.")
    const {csrfToken}=await csrfResponse.json() as {csrfToken?:string}
    if(!csrfToken)throw new Error("Microsoft verification could not start.")
    // Submit from the popup as a real top-level form navigation. Auth.js then
    // sets its transient OAuth cookies on the same browsing context that later
    // receives Microsoft's callback, instead of relying on an XHR redirect.
    const form=popup.document.createElement("form")
    form.method="POST"
    form.action=`${base}/signin/microsoft-entra-id?stepup=1&max_age=0&prompt=login`
    for(const [name,value] of Object.entries({csrfToken,callbackUrl:redirectTo})){
      const input=popup.document.createElement("input")
      input.type="hidden"
      input.name=name
      input.value=value
      form.appendChild(input)
    }
    popup.document.body.appendChild(form)
    form.submit()
  })().catch(()=>{popup.close();onFailure()})
  return popup
}
