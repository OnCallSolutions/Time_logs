/**
 * Converts free-form contractor time notes into structured entries using AI.
 *
 * This route is intentionally focused on parsing only. It accepts raw notes,
 * asks the model for a schema-constrained response, and returns entries for the
 * client to review before they are saved through the entries API.
 */
import { generateText, Output } from "ai"
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"

export const maxDuration = 30

const entrySchema = z.object({
  contractor: z
    .string()
    .describe("Full name of the contractor who worked the hours."),
  date: z
    .string()
    .describe(
      "The date the work was performed, formatted strictly as YYYY-MM-DD. Resolve relative references like 'yesterday', 'Monday', or 'last Tuesday' against the provided current date.",
    ),
  hours: z
    .number()
    .describe(
      "Total hours worked on this date for this project. Convert phrases like 'half day' to 4, 'full day' to 8, '9-5' to 8, '9am to 1pm' to 4.",
    ),
  project: z
    .string()
    .describe("Project, client, or task name. Use 'General' if none is mentioned."),
  description: z
    .string()
    .describe("A short summary of the work described, or an empty string if none."),
})

const schema = z.object({
  entries: z
    .array(entrySchema)
    .describe("One item per distinct unit of work. Preserve separate tasks even for the same person, date, and project."),
})

/**
 * Parses free-form time notes into structured time entries with the AI model.
 *
 * The prompt asks for one entry per contractor, date, and project combination so
 * a single messy paragraph can become several reviewable timesheet rows. Relative
 * dates are resolved against the server's current date.
 *
 * @param req - Request containing the free-form notes in the JSON body.
 * @returns JSON response containing parsed entries or an error.
 */
export async function POST(req: Request) {
  try {
    const session=await auth()
    const email = session?.user?.email
    if (!email || !(await getEffectivePermissions(email)).permissions.create_entries)
      return Response.json({error:"Forbidden."},{status:403})
    const { notes } = (await req.json()) as { notes?: string }

    if (!notes || !notes.trim()) {
      return Response.json({ error: "No notes provided." }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)

    const { output } = await generateText({
      model: "openai/gpt-4.1-mini",
      output: Output.object({ schema }),
      system:
        "You are a meticulous timesheet assistant. Extract every distinct unit of work logged in the notes into structured time entries. " +
        "Notes may be messy, informal, list multiple contractors, span multiple dates, or mix projects. " +
        "Split a single note into multiple entries whenever the contractor, date, or project differs. " +
        `The current date is ${today}. Resolve all relative dates against it. ` +
        "Never invent contractors or hours that are not implied by the text. If hours are ambiguous, make a reasonable best estimate.",
      prompt: `Extract the time entries from these notes:\n\n"""\n${notes}\n"""`,
    })

    const access=await getEffectivePermissions(email)
    const ownOnly=access.role==="contractor"||access.role==="employee"
    return Response.json({ entries: output.entries.map(entry=>ownOnly?{...entry,contractor:session?.user?.name?.trim()||email}:entry) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[parse] AI extraction failed")
    const isAuth = /unauthenticat|api key|gateway/i.test(message)
    return Response.json(
      {
        error: isAuth
          ? "The AI service isn't reachable yet. If you just connected the AI Gateway, give it a moment and try again."
          : "Failed to parse notes. Please try again.",
      },
      { status: 500 },
    )
  }
}
