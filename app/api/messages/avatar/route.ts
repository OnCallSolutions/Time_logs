/**
 * Returns a participant's small profile image only to an account sharing a thread.
 * Images stay outside inbox payloads and are served with a strict image MIME type.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { canViewMessageProfile } from "@/lib/collaboration"
import { getUserProfile } from "@/lib/db"
import { emailSchema } from "@/lib/identity-policy"

/**
 * Serves an authorized conversation participant's profile image.
 * @param request - Request containing the participant email query parameter.
 * @returns Image bytes with private caching, or a non-disclosing not-found response.
 */
export async function GET(request:Request):Promise<Response>{
  const actor=(await auth())?.user?.email?.trim().toLowerCase()
  const access=await getEffectivePermissions(actor)
  if(!actor||!access.role)return new Response(null,{status:401})
  const parsed=emailSchema.safeParse(new URL(request.url).searchParams.get("email"))
  if(!parsed.success)return new Response(null,{status:404})
  const target=parsed.data.toLowerCase()
  const visible=await canViewMessageProfile(actor,target,access.role==="employee"||access.role==="contractor")
  if(!visible)return new Response(null,{status:404})
  const dataUrl=(await getUserProfile(target)).imageDataUrl
  const match=dataUrl?.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-zA-Z0-9+/]+={0,2})$/)
  if(!match)return new Response(null,{status:404})
  const bytes=Buffer.from(match[2],"base64")
  if(!bytes.length||bytes.length>550_000)return new Response(null,{status:404})
  return new Response(bytes,{headers:{
    "Content-Type":`image/${match[1]==="jpg"?"jpeg":match[1]}`,
    "Content-Length":String(bytes.length),
    "Cache-Control":"private, max-age=300",
    "X-Content-Type-Options":"nosniff",
    "Cross-Origin-Resource-Policy":"same-origin",
  }})
}
