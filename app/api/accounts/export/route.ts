/** Authenticated, versioned JSON export of approved account-review snapshots. */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { listHandoffs } from "@/lib/account-handoffs"
import { listTimesheetPeriods } from "@/lib/db"

export const runtime = "nodejs"

/** Returns the selected period/manager slice as a portable, API-ready JSON document. */
export async function GET(request: Request) {
  try {
    const email = (await auth())?.user?.email?.toLowerCase()
    const access = await getEffectivePermissions(email)
    if (!email || !(access.role === "account_manager" || access.role === "admin") || !access.permissions.view_accounts) {
      return Response.json({ error: "Approved timesheet export access is required." }, { status: 403 })
    }

    const query = new URL(request.url).searchParams
    const periodId = query.get("periodId") ?? "all"
    const manager = query.get("manager")?.toLowerCase() ?? "all"
    const workerCategory = query.get("workerCategory") ?? "all"
    const worker = query.get("worker")?.toLowerCase() ?? "all"
    const search = (query.get("search") ?? "").trim().toLowerCase()
    const state = query.get("state") ?? "all"
    const sort = query.get("sort") ?? "newest"
    if (!(["all","employee","contractor"].includes(workerCategory)) || !(["all","pending","needs_information","ready_for_finance","account_approved","returned_to_manager","returned_to_submitter","payout_eligible","archived","stale"].includes(state)) || !(["newest","oldest","hours"].includes(sort))) {
      return Response.json({ error: "One or more export filters are invalid." }, { status: 400 })
    }
    const [periods, handoffs] = await Promise.all([listTimesheetPeriods(), listHandoffs(email, access.role === "admin")])
    const selectedPeriod = periods.find(period => period.id === periodId)
    const periodForDate = (date: string) => periods.find(period => date >= period.startDate && date <= period.endDate)
    if (periodId !== "all" && periodId !== "unassigned" && !selectedPeriod) return Response.json({ error: "Choose a configured timesheet period." }, { status: 400 })
    const records = handoffs.filter(row => {
      const datePeriod = periods.find(period => row.evidence.date >= period.startDate && row.evidence.date <= period.endDate)
      const inPeriod = periodId === "all" || (periodId === "unassigned" ? !datePeriod : !!selectedPeriod && row.evidence.date >= selectedPeriod.startDate && row.evidence.date <= selectedPeriod.endDate)
      const managerMatches = manager === "all" || row.evidence.reviewedBy.toLowerCase() === manager
      const categoryMatches = workerCategory === "all" || (row.evidence.workerCategory ?? "contractor") === workerCategory
      const workerMatches = worker === "all" || row.evidence.contractor.toLowerCase() === worker
      const stateMatches = state === "all" || (state === "stale" ? !row.current : row.review_state === state)
      const searchMatches = `${row.evidence.contractor} ${row.evidence.project} ${row.evidence.reviewedBy} ${row.evidence.description}`.toLowerCase().includes(search)
      return inPeriod && managerMatches && categoryMatches && workerMatches && stateMatches && searchMatches
    }).sort((a,b)=>sort==="hours"?b.evidence.hours-a.evidence.hours:sort==="oldest"?a.evidence.date.localeCompare(b.evidence.date):b.evidence.date.localeCompare(a.evidence.date)).map(row => ({
      handoffId: row.id,
      entryId: row.entry_id,
      periodId: periodForDate(row.evidence.date)?.id ?? null,
      person: row.evidence.contractor,
      ownerEmail: row.evidence.ownerEmail,
      workerCategory: row.evidence.workerCategory ?? "contractor",
      project: row.evidence.project,
      workDate: row.evidence.date,
      approvedHours: row.evidence.hours,
      description: row.evidence.description,
      approvedBy: row.evidence.reviewedBy,
      approvedAt: row.evidence.reviewedAt,
      sourceCurrent: row.current,
      accountReview: { state: row.review_state, note: row.review_note, version: row.review_version },
    }))

    const document = {
      schema: "tanovo-time.approved-timesheets/v1",
      generatedAt: new Date().toISOString(),
      generatedFor: email,
      filters: { periodId, manager, workerCategory, worker, search, state, sort },
      period: selectedPeriod ? { id: selectedPeriod.id, name: selectedPeriod.name, startDate: selectedPeriod.startDate, endDate: selectedPeriod.endDate, submissionDeadline: selectedPeriod.submissionDeadline } : periodId === "unassigned" ? { id: null, name: "Outside configured periods", startDate: null, endDate: null, submissionDeadline: null } : null,
      count: records.length,
      totalApprovedHours: records.reduce((sum, row) => sum + Number(row.approvedHours), 0),
      records,
    }
    return Response.json(document, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="approved-timesheets-${periodId === "all" ? "all-periods" : periodId}.json"`,
      },
    })
  } catch {
    return Response.json({ error: "Approved timesheet export is unavailable." }, { status: 503 })
  }
}
