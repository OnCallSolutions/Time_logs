import {stepUpSignIn} from "@/step-up-auth"
import {apiPath} from "@/lib/paths"

/** Popup landing page that starts sensitive-action verification through Auth.js. */
export default async function ReauthenticationStartPage({searchParams}:{searchParams:Promise<{state?:string}>}){
  const {state=""}=await searchParams
  if(!/^[a-f0-9-]{36}$/i.test(state))return <main className="grid min-h-dvh place-items-center bg-white p-6 text-center text-slate-900"><p role="alert">This verification link is invalid. Close this window and try again.</p></main>

  async function startMicrosoftVerification():Promise<void>{
    "use server"
    await stepUpSignIn("microsoft-entra-id",{
      redirectTo:apiPath(`/reauth-complete?state=${encodeURIComponent(state)}`),
    },{max_age:"0",prompt:"login"})
  }

  return <main className="grid min-h-dvh place-items-center bg-white p-6 text-center text-slate-900">
    <form action={startMicrosoftVerification} className="flex max-w-sm flex-col items-center gap-4">
      <p className="text-sm">Continue to Microsoft to verify this sensitive change.</p>
      <button type="submit" className="rounded border border-orange-600 bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">Continue to Microsoft</button>
    </form>
  </main>
}
