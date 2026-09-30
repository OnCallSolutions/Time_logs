import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { getUserProfile, upsertUserProfile } from "@/lib/db"

export const runtime = "nodejs"

const maxImageDataUrlLength = 750_000

const profileSchema = z.object({
  displayName: z.string().trim().max(80).default(""),
  imageDataUrl: z
    .string()
    .max(maxImageDataUrlLength)
    .regex(/^data:image\/(png|jpe?g|gif|webp);base64,/)
    .nullable(),
})

async function getProfileAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = getEffectiveUserRole(email)

  if (!email || !role) {
    return null
  }

  return { email }
}

export async function GET() {
  try {
    const access = await getProfileAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const profile = await getUserProfile(access.email)
    return Response.json({ profile })
  } catch (err) {
    console.error("[profile] load failed:", err)
    return Response.json(
      { error: "Failed to load profile." },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  try {
    const access = await getProfileAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const profile = profileSchema.parse(await req.json())
    const savedProfile = await upsertUserProfile(access.email, profile)
    return Response.json({ profile: savedProfile })
  } catch (err) {
    console.error("[profile] save failed:", err)
    return Response.json(
      { error: "Failed to save profile." },
      { status: 400 },
    )
  }
}
