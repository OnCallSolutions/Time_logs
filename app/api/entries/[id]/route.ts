import { z } from "zod"
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const patch = patchSchema.parse(await req.json())
    const entry = await updateTimeEntry(id, patch)

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
    const { id } = await params
    await deleteTimeEntry(id)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] delete failed:", err)
    return Response.json(
      { error: "Failed to delete entry." },
      { status: 500 },
    )
  }
}
