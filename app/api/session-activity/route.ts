/**
 * Exposes bounded session deadlines without letting polling renew idle sessions.
 * Only an explicit same-origin activity request can extend a still-live idle limit.
 * Expired sessions cannot be revived; Microsoft authentication remains required.
 */
import {auth} from "@/auth"
import {readAppSession} from "@/lib/app-sessions"
/** @returns Promise<Response> with server deadlines, never a renewed cookie/session. */
export async function GET():Promise<Response>{return status(false)}
/**
 * Accepts an explicit activity signal from the authenticated same-origin app.
 * @param request - Browser request whose Origin must match the current app origin.
 * @returns Promise<Response> with refreshed idle expiry, still bounded by sign-in time.
 */
export async function POST(request:Request):Promise<Response>{
  if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Forbidden."},{status:403})
  return status(true)
}
/**
 * Resolves session identity only from authentication and checks server-side limits.
 * @param interactive - Whether this request explicitly represents user activity.
 * @returns Promise<Response> with a live deadline or a non-cacheable denial.
 */
async function status(interactive:boolean):Promise<Response>{
  const headers={"Cache-Control":"no-store"}
  try{
    const session=await auth()
    if(!session?.appSessionId||!session.user?.email)return Response.json({error:"Sign in again."},{status:401,headers})
    const state=await readAppSession(session.appSessionId,session.user.email,interactive)
    return state?Response.json({...state,email:session.user.email,serverTime:new Date().toISOString()},{headers}):Response.json({error:"Your session expired. Sign in again."},{status:401,headers})
  }catch{return Response.json({error:"Session verification unavailable."},{status:503,headers})}
}
