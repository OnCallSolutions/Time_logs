/** Loads or initializes the signed-in patron's company/workspace assistant memory. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getAssistantConversation, readAssistantRequest } from "@/lib/assistant-security"
import { z } from "zod"

const inputSchema=z.object({workspaceContext:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/)}).strict()

/** @param request - Same-origin JSON request naming the visible workspace. @returns Recent private assistant conversation or a safe error. */
export async function POST(request:Request):Promise<Response>{
  let input
  try{input=inputSchema.parse(await readAssistantRequest(request,2000))}catch{return Response.json({error:"Invalid assistant workspace."},{status:400})}
  try{
    const session=await auth(),email=session?.user?.email
    if(!email)return Response.json({error:"Sign in again to use the assistant."},{status:401})
    const access=await getEffectivePermissions(email)
    if(!access.role)return Response.json({error:"Forbidden."},{status:403})
    const conversation=await getAssistantConversation(email,input.workspaceContext)
    return Response.json(conversation,{headers:{"Cache-Control":"private, no-store"}})
  }catch{
    console.error("[assistant] conversation load failed")
    return Response.json({error:"Assistant memory is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}})
  }
}
