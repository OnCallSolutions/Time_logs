import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { getTeamsTranscriptConnectionStatus } from "@/lib/teams-transcript-connections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const email = (await auth())?.user?.email?.trim().toLowerCase()
  if (!email) return Response.json({ error: "Sign in to view Teams connection status." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try {
    const [connection, access] = await Promise.all([getTeamsTranscriptConnectionStatus(email), getEffectivePermissions(email)])
    return Response.json({
      ...connection,
      developmentProcessingAvailable: process.env.NODE_ENV === "development" && access.role === "admin",
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Teams connection status is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
