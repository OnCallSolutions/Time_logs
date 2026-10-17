"use client"

type ClientFailure={operation:string;route:string;message:string;status?:number;reference?:string}
import {apiPath} from "@/lib/paths"

/** Reports compact, non-sensitive failure diagnostics without delaying the failed action. */
export function reportClientFailure(failure:ClientFailure):string{
  const existing=failure.reference??failure.message.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0]
  const reference=existing??crypto.randomUUID()
  void fetch(apiPath("/api/client-errors"),{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({...failure,reference})}).catch(()=>{})
  return reference
}
