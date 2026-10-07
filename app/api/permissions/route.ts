/**
 * Returns live role and control rights for the signed-in account only.
 * Clients refresh this endpoint on focus and periodically to reflect admin saves.
 * No employee can request another user's permissions through this endpoint.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
/**
 * Resolves current rights without caching potentially revoked permissions.
 * @returns Promise<Response> with current permissions or denied access.
 */
export async function GET(): Promise<Response> {
  const email = (await auth())?.user?.email
  if (!email) return Response.json({error:"Unauthorized."},{status:401})
  const access = await getEffectivePermissions(email)
  return Response.json(access,{status:access.role ? 200 : 403,headers:{"Cache-Control":"no-store"}})
}
