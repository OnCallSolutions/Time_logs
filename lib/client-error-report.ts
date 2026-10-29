"use client"

type ClientFailure={operation:string;route:string;message:string;status?:number;code?:string;method?:"GET"|"POST"|"PUT"|"PATCH"|"DELETE";reference?:string}
import {apiPath} from "@/lib/paths"

const recentFailures=new Map<string,{reference:string;expiresAt:number}>()
const reportedReferences=new Map<string,number>()

function sanitizeFailureMessage(message:string):string{
  return message
    .replace(/\bBearer\s+\S+/gi,"Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,"[redacted token]")
    .replace(/([?&](?:access_token|token|code|client_secret|api_key|key)=)[^&#\s]*/gi,"$1[redacted]")
    .replace(/\b([\w-]*(?:secret|password|api[_-]?key|access[_-]?token))\s*[:=]\s*[^\s,;]+/gi,"$1=[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,"[redacted email]")
    .replace(/[\u0000-\u001f\u007f]/g," ")
    .slice(0,240)
}

/** Reports compact, non-sensitive failure diagnostics without delaying the failed action. */
export function reportClientFailure(failure:ClientFailure):string{
  const now=Date.now()
  for(const [key,item] of recentFailures)if(item.expiresAt<=now)recentFailures.delete(key)
  for(const [reference,expiresAt] of reportedReferences)if(expiresAt<=now)reportedReferences.delete(reference)
  const message=sanitizeFailureMessage(failure.message)
  const fingerprint=[failure.operation,failure.route,failure.method??"",failure.status??"",failure.code??"",message.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,"[id]").trim()].join("|").toLowerCase()
  const existing=failure.reference??failure.message.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0]
  const cached=recentFailures.get(fingerprint)
  const reference=existing??(cached&&cached.expiresAt>now?cached.reference:crypto.randomUUID())
  recentFailures.set(fingerprint,{reference,expiresAt:now+120_000})
  if(!reportedReferences.has(reference)){
    reportedReferences.set(reference,now+120_000)
    void fetch(apiPath("/api/client-errors"),{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({...failure,message,reference})}).catch(()=>{reportedReferences.delete(reference)})
  }
  return reference
}
