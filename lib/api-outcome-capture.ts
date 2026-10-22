/** Captures sanitized failed API outcomes without changing the response path. */
import "server-only"
import { auth } from "@/auth"
import { getAuditContext } from "@/lib/audit"

function outcomeCategory(status:number){
  if(status===401||status===403)return "authorization_denied"
  if(status===400||status===413||status===422)return "validation_failed"
  if(status===409||status===412)return "workflow_conflict"
  return status>=500?"server_error":"request_failed"
}

/** Wraps a route handler and stores error responses and thrown server failures. */
export function withOperationalCapture<T extends (...args:any[])=>Promise<Response>>(route:string,method:string,handler:T):T{
  return (async(...args:Parameters<T>)=>{
    const request=args[0] instanceof Request?args[0]:null
    try{
      const response=await handler(...args)
      if(response.status>=400)await captureFailure(request,route,method,response.status,response.clone())
      return response
    }catch(error){
      await captureFailure(request,route,method,500,error)
      throw error
    }
  }) as T
}

async function captureFailure(request:Request|null,route:string,method:string,status:number,source:unknown){
  try{
    let email="anonymous"
    try{email=(await auth())?.user?.email??email}catch{}
    const context=request?getAuditContext(request):null
    const suppliedCorrelation=request?.headers.get("x-correlation-id")??null
    const correlationId=suppliedCorrelation&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedCorrelation)?suppliedCorrelation:crypto.randomUUID()
    let message="Request failed."
    let code=`HTTP_${status}`
    if(source instanceof Response){
      try{
        const body=await source.json() as {error?:unknown;code?:unknown;reference?:unknown}
        if(typeof body.error==="string")message=body.error
        if(typeof body.code==="string"&&/^[A-Z0-9_.-]{1,40}$/.test(body.code))code=body.code
      }catch{}
    }else if(source instanceof Error)message=source.message
    const {recordOperationalEvent,sanitizeOperationalMessage}=await import("@/lib/operational-events")
    await recordOperationalEvent({
      correlationId,actorEmail:email,category:outcomeCategory(status),
      operation:`api.${method.toLowerCase()}.${route.replace(/^\/api\//,"").replaceAll("/",".").replaceAll("[id]","record")}`,
      route,method,httpStatus:status,errorCode:code,message:sanitizeOperationalMessage(message),requestId:context?.requestId??null,
    })
  }catch(error){
    console.warn("[api-outcome-capture] Could not persist failure event",{route,status,error:error instanceof Error?error.name:"unknown"})
  }
}
