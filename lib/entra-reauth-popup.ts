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
  try{
    popup.location.href=`${window.location.origin}${apiPath(`/reauth-start?state=${encodeURIComponent(state)}`)}`
  }catch{
    popup.close()
    onFailure()
    return null
  }
  return popup
}
