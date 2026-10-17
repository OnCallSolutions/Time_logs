/** Provides sanitized AI workflow telemetry to admins in the bound company only. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAssistantRuns } from "@/lib/assistant-security"
import { z } from "zod"

const querySchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),beforeAt:z.string().datetime().optional(),beforeId:z.string().uuid().optional()}).strict()

/** @param request - Read-only page request. @returns Company-scoped sanitized run events or an authorization error. */
export async function GET(request:Request):Promise<Response>{
  const session=await auth(),email=session?.user?.email
  if(!email)return Response.json({error:"Sign in again."},{status:401,headers:{"Cache-Control":"no-store"}})
  const access=await getEffectivePermissions(email)
  if(access.role!=="admin")return Response.json({error:"Only administrators can view AI workflow activity."},{status:403,headers:{"Cache-Control":"no-store"}})
  const url=new URL(request.url),parsed=querySchema.safeParse(Object.fromEntries(url.searchParams))
  if(!parsed.success||Boolean(parsed.data.beforeAt)!==Boolean(parsed.data.beforeId))return Response.json({error:"Invalid AI activity page."},{status:400,headers:{"Cache-Control":"no-store"}})
  try{
    const {limit,beforeAt,beforeId}=parsed.data
    const runs=await listAssistantRuns(limit,beforeAt&&beforeId?{startedAt:beforeAt,id:beforeId}:undefined)
    return Response.json({runs,hasMore:runs.length===limit},{headers:{"Cache-Control":"private, no-store"}})
  }catch{
    console.error("[assistant] activity report failed")
    return Response.json({error:"AI activity is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}})
  }
}
