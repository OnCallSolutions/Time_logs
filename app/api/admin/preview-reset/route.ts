import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resetPreviewData } from "@/lib/preview-data-reset"
import { z } from "zod"

export const runtime="nodejs"
const confirmationSchema=z.object({confirmation:z.literal("RESET PREVIEW DATA")}).strict()

/** Executes an explicit, administrator-only preview reset after typed confirmation. */
export async function POST(request:Request):Promise<Response>{
  if(process.env.VERCEL_ENV!=="preview"||process.env.TANOVO_DATABASE_ENVIRONMENT!=="preview")return Response.json({error:"Preview data reset requires a Vercel Preview deployment connected to a database explicitly marked as preview."},{status:403})
  if(request.headers.get("origin")!==new URL(request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Invalid request origin."},{status:403})
  const session=await auth(),email=session?.user?.email
  if(!email)return Response.json({error:"Sign in again."},{status:401})
  const access=await getEffectivePermissions(email)
  if(access.role!=="admin")return Response.json({error:"Only an administrator can reset preview data."},{status:403})
  try{
    const body=confirmationSchema.parse(await request.json())
    if(body.confirmation!=="RESET PREVIEW DATA")return Response.json({error:"Type the exact confirmation phrase."},{status:400})
    const deleted=await resetPreviewData(email,request)
    return Response.json({ok:true,deleted},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Invalid reset confirmation."},{status:400})
    console.error("[preview-reset] Reset failed.")
    return Response.json({error:"Preview data could not be reset. No deployment-time cleanup was run."},{status:503})
  }
}
