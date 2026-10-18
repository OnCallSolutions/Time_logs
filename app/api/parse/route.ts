/**
 * Converts free-form contractor time notes into structured entries using AI.
 *
 * This route is intentionally focused on parsing only. It accepts raw notes,
 * asks the model for a schema-constrained response, and returns entries for the
 * client to review before they are saved through the entries API.
 */
import { generateText, Output } from "ai"
import { z } from "zod"
import { listAccountIdentities } from "@/lib/account-identities"
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listTimesheetPeriods } from "@/lib/db"
import { checkApiRateLimit } from "@/lib/api-rate-limit"
import { getAiModel } from "@/lib/ai-models"

export const maxDuration = 30
const MAX_REQUEST_BYTES=16_384

class RequestTooLargeError extends Error{}

async function readJsonBody(request:Request):Promise<unknown>{
  const reader=request.body?.getReader()
  if(!reader)return {}
  const chunks:Uint8Array[]=[]
  let size=0
  while(true){
    const {done,value}=await reader.read()
    if(done)break
    size+=value.byteLength
    if(size>MAX_REQUEST_BYTES){await reader.cancel();throw new RequestTooLargeError()}
    chunks.push(value)
  }
  const body=new Uint8Array(size)
  let offset=0
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder().decode(body))
}

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
      "Hours for this individual work unit, not the sum of other tasks on the same date/project. Convert 'half day' to 4, 'full day' to 8, '9-5' to 8, '9am to 1pm' to 4.",
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
 * The prompt asks for one entry per distinct work unit, including repeated
 * contractor/date/project combinations, so
 * a single messy paragraph can become several reviewable timesheet rows. Relative
 * dates are resolved against the server's current date.
 *
 * @param req - Request containing the free-form notes in the JSON body.
 * @returns JSON response containing parsed entries or an error.
 */
export async function POST(req: Request) {
  try {
    if(Number(req.headers.get("content-length")??0)>MAX_REQUEST_BYTES)return Response.json({error:"Extraction request is too large."},{status:413})
    const session=await auth()
    const email = session?.user?.email
    if (!email || !(await getEffectivePermissions(email)).permissions.create_entries)
      return Response.json({error:"Forbidden."},{status:403})
    const rate=await checkApiRateLimit(email,"timesheet-extraction",5,req)
    if(!rate.allowed)return Response.json({error:"Too many extraction requests. Wait a minute before trying again."},{status:429,headers:{"Retry-After":"60","Cache-Control":"no-store"}})
    const input=z.object({notes:z.string().trim().min(1).max(12_000),periodId:z.string().uuid()}).strict().parse(await readJsonBody(req))
    const {notes,periodId}=input

    if (!notes || !notes.trim()) {
      return Response.json({ error: "No notes provided." }, { status: 400 })
    }
    if (/SAMPLE-(?:CTR|EMP|MGR)-\d{3}/i.test(notes)) {
      return Response.json({ error: "Display-only synthetic samples cannot be extracted or submitted." }, { status: 400 })
    }
    const period=(await listTimesheetPeriods()).find(candidate=>candidate.id===periodId)
    if(!period)return Response.json({error:"Select a configured timesheet period before extracting entries."},{status:400})

    const today = new Date().toISOString().slice(0, 10)

    const { output } = await generateText({
      model: getAiModel("timesheetExtraction"),
      output: Output.object({ schema }),
      system:
        "You are a meticulous timesheet assistant. Extract every distinct unit of work logged in the notes into structured time entries. " +
        "Notes may be messy, informal, list multiple contractors, span multiple dates, or mix projects. " +
        "Split a single note into multiple entries whenever the contractor, date, or project differs. " +
        "Keep separately listed tasks or time blocks as separate entries even when the person, date, and project match. Never merge, deduplicate, sum, or truncate those entries. " +
        `The selected timesheet period is ${period.name}, from ${period.startDate} through ${period.endDate}. Every extracted work date must fall within this period; do not move or invent dates to force a match. ` +
        `The current date is ${today}. Resolve all relative dates against it. ` +
        "Never invent contractors or hours that are not implied by the text. If hours are ambiguous, make a reasonable best estimate.",
      prompt: `Extract the time entries from these notes:\n\n"""\n${notes}\n"""`,
    })

    if(output.entries.some(entry=>entry.date<period.startDate||entry.date>period.endDate))return Response.json({error:`Some work dates are outside ${period.name} (${period.startDate}–${period.endDate}). Choose the correct period or correct the dates.`},{status:422})
    const access=await getEffectivePermissions(email)
    if(!access.role||!access.permissions.create_entries)return Response.json({error:"Extraction access changed. Please sign in again."},{status:403})
    const ownOnly=access.role==="contractor"||access.role==="employee"
    const identity=(await listAccountIdentities([email]))[0]
    return Response.json({ entries: output.entries.map(entry=>ownOnly?{...entry,contractor:identity?.officialName||session?.user?.name?.trim()||email}:entry),periodId:period.id })
  } catch (err) {
    if(err instanceof RequestTooLargeError)return Response.json({error:"Extraction request is too large."},{status:413})
    if(err instanceof z.ZodError||err instanceof SyntaxError)return Response.json({error:"Enter notes and select a valid configured timesheet period."},{status:400})
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
