import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import {
  clearTimeEntries,
  createTimeEntries,
  listTimeEntries,
} from "@/lib/db"

export const runtime = "nodejs"

const entrySchema = z.object({
  contractor: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().min(0),
  project: z.string().trim().min(1).default("General"),
  description: z.string().default(""),
})

const createSchema = z.object({
  entries: z.array(entrySchema).min(1),
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

export async function GET() {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const entries = await listTimeEntries(access.email, access.includeAll)
    return Response.json({ entries })
  } catch (err) {
    console.error("[entries] list failed:", err)
    return Response.json(
      { error: "Failed to load saved entries." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    const body = createSchema.parse(await req.json())
    const entries = await createTimeEntries(access.email, body.entries)
    return Response.json({ entries }, { status: 201 })
  } catch (err) {
    console.error("[entries] create failed:", err)
    return Response.json(
      { error: "Failed to save entries." },
      { status: 400 },
    )
  }
}

export async function DELETE() {
  try {
    const access = await getAccess()
    if (!access) {
      return Response.json({ error: "Unauthorized." }, { status: 401 })
    }

    await clearTimeEntries(access.email, access.includeAll)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[entries] clear failed:", err)
    return Response.json(
      { error: "Failed to clear entries." },
      { status: 500 },
    )
  }
}
