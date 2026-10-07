/**
 * Handles persistent profile reads and updates for the signed-in user.
 *
 * Profiles store user-facing display preferences, including a display name and
 * optional data URL image. Access is scoped to the authenticated email so users
 * can only read or update their own profile.
 */
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { getAuditContext } from "@/lib/audit"
import {
  getUserProfile,
  recordAuditEvent,
  upsertUserProfile,
} from "@/lib/db"

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

/**
 * Resolves whether the current request can access a user profile.
 *
 * The same allowlist and role rules used by the timesheet app are applied here.
 * A successful result only exposes the caller's own email because profiles are
 * self-service rather than manager-editable.
 *
 * @returns Profile access metadata for the signed-in user, or null when denied.
 */
async function getProfileAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = await getEffectiveUserRole(email)

  if (!email || !role) {
    return null
  }

  return { email }
}

/**
 * Returns the signed-in user's persisted profile.
 *
 * Missing profile rows are returned as empty profile values by the database
 * helper, which keeps first-time profile editing simple for the client.
 *
 * @returns JSON response containing the user's profile or an error.
 */
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

/**
 * Creates or updates the signed-in user's persisted profile.
 *
 * The request body is schema-validated to keep names short and image payloads
 * bounded to small browser-friendly data URLs.
 *
 * @param req - Request containing profile fields in the JSON body.
 * @returns JSON response containing the saved profile or an error.
 */
export async function PUT(req: Request) {
  try {
    const access = await getProfileAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const profile = profileSchema.parse(await req.json())
    const previousProfile = await getUserProfile(access.email)
    const savedProfile = await upsertUserProfile(access.email, profile)
    await recordAuditEvent({
      actorEmail: access.email,
      action: "profile_updated",
      targetType: "user_profile",
      targetId: access.email,
      metadata: {
        displayNameChanged:
          previousProfile.displayName !== savedProfile.displayName,
        imageChanged: previousProfile.imageDataUrl !== savedProfile.imageDataUrl,
      },
      ...getAuditContext(req),
    })

    return Response.json({ profile: savedProfile })
  } catch (err) {
    console.error("[profile] save failed:", err)
    return Response.json(
      { error: "Failed to save profile." },
      { status: 400 },
    )
  }
}
