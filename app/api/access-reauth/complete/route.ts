import {auth} from "@/auth"
import {stepUpAuth,stepUpSessionCookieName} from "@/step-up-auth"
import {markAppSessionFresh} from "@/lib/app-sessions"
import {normalizeEmail} from "@/lib/identity-policy"

/** Accepts only a fresh, same-account Entra step-up and refreshes the existing app session. */
export async function POST(request:Request):Promise<Response>{
  const headers={"Cache-Control":"no-store"}
  if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Forbidden."},{status:403,headers})
  try{
    const body=await request.json() as {state?:unknown}
    if(typeof body.state!=="string"||!/^[a-f0-9-]{36}$/i.test(body.state))return Response.json({error:"Invalid verification state."},{status:400,headers})
    const [appSession,stepUpSession]=await Promise.all([auth(),stepUpAuth()])
    const email=appSession?.user?.email
    const stepUpEmail=stepUpSession?.user?.email
    const stepUpAuthenticatedAt=(stepUpSession as typeof stepUpSession&{stepUpAuthenticatedAt?:number|null}|null)?.stepUpAuthenticatedAt
    if(!appSession?.appSessionId||!email||!stepUpEmail||normalizeEmail(email)!==normalizeEmail(stepUpEmail)||typeof stepUpAuthenticatedAt!=="number"||Date.now()-stepUpAuthenticatedAt>5*60_000||stepUpAuthenticatedAt>Date.now()+30_000){
      return Response.json({error:"Microsoft verification expired or used a different account."},{status:401,headers})
    }
    if(!await markAppSessionFresh(appSession.appSessionId,email))return Response.json({error:"The app session expired. Sign in again before changing access."},{status:401,headers})
    const secure=process.env.NODE_ENV==="production"?"; Secure":""
    return Response.json({ok:true},{headers:{...headers,"Set-Cookie":`${stepUpSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`}})
  }catch{
    return Response.json({error:"Microsoft verification could not be confirmed."},{status:503,headers})
  }
}
