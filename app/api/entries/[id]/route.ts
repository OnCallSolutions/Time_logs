import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { deleteTimeEntry, updateTimeEntry } from "@/lib/db"

export const runtime = "nodejs"

const patchSchema = z
  .object({
    contractor: z.string().trim().min(1).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hours: z.number().min(0).optional(),
    project: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one field is required.",
  })

async function getAccess() {
  const session = await auth()
  const email = session?.user?.email ?? null
  const role = getEffectiveUserRole(email)

  if (!email || !role) {
    return null
  }

  return {
    email,
    includeAll: role === "admin" || role === "manager",
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { id } = await params
    const patch = patchSchema.parse(await req.json())
    const entry = await updateTimeEntry(
      access.email,
      id,
      patch,
      access.includeAll,
    )

    if (!entry) {
      return Response.json({ error: "Entry not found." }, { status: 404 })
    }

    return Response.json({ entry })
  } catch (err) {
    console.error("[entries] update failed:", err)
    return Response.json(
      { error: "Failed to update entry." },
      { status: 400 },
    )
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { id } = await params
    await deleteTimeEntry(access.email, id, access.includeAll)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] delete failed:", err)
    return Response.json(
      { error: "Failed to delete entry." },
      { status: 500 },
    )
  }
}
