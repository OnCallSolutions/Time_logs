import { signIn } from "next-auth/react"
import { apiPath } from "@/lib/paths"

/** Opens the existing Entra provider flow in a small popup without navigating the workspace. */
export function openEntraReauthentication(state:string,onFailure:()=>void):Window|null{
  const popup=window.open("about:blank","tanovo-microsoft-step-up","popup,width=480,height=640,resizable=yes,scrollbars=yes")
  if(!popup)return null
  const redirectTo=`${window.location.origin}${apiPath(`/reauth-complete?state=${encodeURIComponent(state)}`)}`
  void signIn("microsoft-entra-id",{redirect:false,redirectTo},{max_age:"0",prompt:"login"}).then(result=>{
    if(!result.ok||!result.url)throw new Error("Microsoft verification could not start.")
    popup.location.href=result.url
  }).catch(()=>{popup.close();onFailure()})
  return popup
}
