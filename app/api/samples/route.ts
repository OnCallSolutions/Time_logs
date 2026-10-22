/**
 * Provides clearly synthetic timesheet examples scoped to authenticated roles.
 * Personal examples use only the signed-in name and preserve repeated projects.
 * Account-manager examples are previews only and never persist timesheet records.
 */
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listTimeEntries,listTimeProjects,listTimesheetPeriods } from "@/lib/db"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listAccountIdentities } from "@/lib/account-identities"
import { createReviewAccess } from "@/lib/review-access"
import { randomInt } from "node:crypto"

type SampleActor = { name: string; id: string }

/**
 * Resolves distinct, authorized people for a non-submittable demonstration.
 * Admins may use active company employee/contractor names; managers are limited
 * to people whose entries are visible in their own review scope.
 * @param email - Authenticated sample requester.
 * @param access - Live role and permissions for the requester.
 * @returns Sample actors with synthetic identifiers, never real account IDs.
 */
async function sampleActors(email: string, access: NonNullable<Awaited<ReturnType<typeof getEffectivePermissions>>>): Promise<SampleActor[]> {
  const role = access.role
  if (role !== "admin" && role !== "manager") return [
    { name: "Sample Contractor A", id: "SAMPLE-CTR-001" },
    { name: "Sample Employee B", id: "SAMPLE-EMP-002" },
    { name: "Sample Manager C", id: "SAMPLE-MGR-003" },
  ]

  let eligibleEmails: string[]
  if (role === "admin") {
    const identities = await listAccountIdentities()
    const activeRoles = await Promise.all(identities.map(async identity => ({
      email: identity.email,
      role: await getEffectiveUserRole(identity.email),
      name: identity.officialName,
    })))
    eligibleEmails = activeRoles.filter(actor => actor.role === "employee" || actor.role === "contractor").map(actor => actor.email)
  } else {
    const resolve = createReviewAccess(email, access)
    const rows = await listTimeEntries(email, true)
    const visibleEmails = new Set<string>()
    for (const entry of rows) {
      const owner = entry.ownerEmail?.toLowerCase()
      if (!owner || owner === email.toLowerCase()) continue
      const [scope, ownerRole] = await Promise.all([resolve(entry), getEffectiveUserRole(owner)])
      if (scope.visible && (ownerRole === "employee" || ownerRole === "contractor")) visibleEmails.add(owner)
    }
    eligibleEmails = [...visibleEmails]
  }

  const identities = await listAccountIdentities(eligibleEmails)
  const candidateRoles = await Promise.all(identities.map(async identity => ({
    identity,
    role: await getEffectiveUserRole(identity.email),
  })))
  const candidates = candidateRoles.filter(actor => actor.role === "employee" || actor.role === "contractor")
    .sort((a, b) => a.identity.officialName.localeCompare(b.identity.officialName))
    .slice(0, 5)
  if (!candidates.length) return [
    { name: "Sample Contractor A", id: "SAMPLE-CTR-001" },
    { name: "Sample Employee B", id: "SAMPLE-EMP-002" },
    { name: "Sample Employee C", id: "SAMPLE-EMP-003" },
  ]
  return candidates.map(({ identity, role: actorRole }, index) => ({
    name: identity.officialName,
    id: `SAMPLE-${actorRole === "contractor" ? "CTR" : "EMP"}-${String(index + 1).padStart(3, "0")}`,
  }))
}
/**
 * Returns role-specific sample notes without accepting client-supplied identities.
 * @param request - Optional fixed count for repeatable tests, or random (3-18) by default.
 * @returns Promise<Response> containing synthetic notes, or validation/access failure.
 */
export async function GET(request?: Request):Promise<Response>{
  const session=await auth(),email=session?.user?.email
  const access=await getEffectivePermissions(email)
  if(!email||!access.role||!(access.permissions.create_entries||(access.role==="account_manager"&&access.permissions.view_accounts)))return Response.json({error:"Sample access is not permitted."},{status:403})
  const requested=request ? new URL(request.url).searchParams.get("count") ?? "random" : "random"
  const format=request ? new URL(request.url).searchParams.get("format") : null
  if(format==="teams-transcript"){
    const periodId=request ? new URL(request.url).searchParams.get("periodId") : null
    const period=(await listTimesheetPeriods()).find(candidate=>candidate.id===periodId)
    if(!period)return Response.json({error:"Select a configured timesheet period before loading the sample transcript."},{status:400})
    const availableProjects=await listTimeProjects(false,access.role==="contractor"||access.role==="employee"?email:undefined)
    const assignedProject=availableProjects[0]?.name
    if(!assignedProject)return Response.json({error:"There is no available project for this account. Ask your manager to assign one before trying the sample."},{status:409})
    const identity=(await listAccountIdentities([email]))[0]
    const speaker=identity?.officialName||session?.user?.name?.trim()||email
    const notes=[
      "Synthetic Microsoft Teams transcript for extraction testing. This is not a real meeting or work record.",
      `[00:02:14] ${speaker}: For ${period.startDate}, I spent 2 hours on ${assignedProject} completing an implementation task.`,
      `[00:02:32] ${speaker}: I also documented the work and next steps.`,
    ].join("\n")
    // A fixed fallback keeps this demo inspectable when the configured model is temporarily unavailable.
    // It is deliberately returned only for this synthetic fixture, never for real transcript or note content.
    const demoEntries=[{contractor:speaker,date:period.startDate,hours:2,project:assignedProject,description:"Implementation task"}]
    return Response.json({notes,synthetic:true,transcript:true,project:assignedProject,periodId:period.id,demoEntries},{headers:{"Cache-Control":"no-store"}})
  }
  const count=requested==="random"?randomInt(3,19):Number(requested)
  if(requested!=="random"&&![3,6,12].includes(count))return Response.json({error:"Choose random, 3, 6, or 12 sample entries per person."},{status:400})
  const identity=(await listAccountIdentities([email]))[0]
  const actors=access.role==="manager"||access.role==="admin"||access.role==="account_manager"
    ? await sampleActors(email,access)
    : [{name:identity?.officialName||session?.user?.name?.trim()||email,id:identity?.shortReference||identity?.contractorNumber||"SAMPLE-USER-001"}]
  const today=new Date()
  const tasks=["documentation task","testing task","implementation task"]
  const projects=(await listTimeProjects(false,access.role==="manager"||access.role==="admin"||access.role==="account_manager"?undefined:email)).map(project=>project.name)
  if(!projects.length&& (access.role==="contractor"||access.role==="employee"))return Response.json({error:"No projects are assigned to your account yet. Ask your manager to assign a project before generating entry samples."},{status:409})
  const sampleProjects=projects.length?projects:["Sample Project Alpha","Sample Project Beta","Sample Integration","Sample Field Operations"]
  const notes=actors.flatMap(actor=>Array.from({length:count},(_,index)=>{
    const date=new Date(today)
    date.setUTCDate(today.getUTCDate()-Math.floor(index/3))
    const project=sampleProjects[index%sampleProjects.length]
    return `${actor.name} (ID: ${actor.id}): ${date.toISOString().slice(0,10)}, ${[1.5,2,0.75][index%3]} hours on ${project}, ${tasks[index%3]}.`
  })).join("\n")
  return Response.json({notes,count,people:actors.length,synthetic:true,previewOnly:access.role==="manager"||access.role==="admin"||access.role==="account_manager"},{headers:{"Cache-Control":"no-store"}})
}
