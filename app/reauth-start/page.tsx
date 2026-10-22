import {ReauthenticationStart} from "@/components/reauthentication-start"

/** Popup landing page that starts the sensitive-action verification in-place. */
export default async function ReauthenticationStartPage({searchParams}:{searchParams:Promise<{state?:string}>}){
  const {state=""}=await searchParams
  return <ReauthenticationStart state={state}/>
}
