import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { acceptCurrentTerms } from "@/lib/terms-of-use"
import { CURRENT_TERMS_VERSION } from "@/lib/terms-constants"

export const runtime="nodejs"

export async function POST(request:Request){
  try{
    const email=(await auth())?.user?.email
    if(!email||!await getEffectiveUserRole(email))return Response.json({error:"Sign in with an approved account to accept the terms."},{status:401})
    const input=z.object({accepted:z.literal(true),version:z.literal(CURRENT_TERMS_VERSION)}).strict().parse(await request.json())
    await acceptCurrentTerms(email,request)
    return Response.json({accepted:true,version:input.version},{headers:{"Cache-Control":"no-store"}})
  }catch(error){
    const invalid=error instanceof z.ZodError||error instanceof SyntaxError
    return Response.json({error:invalid?"Confirm the current Terms of Use to continue.":"Your acceptance could not be recorded. Please retry."},{status:invalid?400:503})
  }
}
