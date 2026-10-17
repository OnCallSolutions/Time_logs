import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { neon } from "@neondatabase/serverless"

const root = process.cwd()
for (const file of [".env.local", ".env.development.local", ".env"]) {
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2")
      process.env[match[1]] = value
    }
  } catch {}
}

if (process.env.DEMO_SEED_TARGET !== "development") {
  throw new Error("Set DEMO_SEED_TARGET=development to seed the development database.")
}
if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("Demo timesheets cannot be seeded into a production runtime.")
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.")

const sql = neon(process.env.DATABASE_URL)
const identityRows = await sql`SELECT a.email,a.official_name,a.contractor_number,m.role AS managed_role,m.access_status
  FROM account_identities a LEFT JOIN managed_user_access m ON lower(m.email)=lower(a.email)
  ORDER BY a.official_name`
const environmentRoles = new Map()
for (const [role, key] of [
  ["admin", "ADMIN_EMAILS"],
  ["manager", "MANAGER_EMAILS"],
  ["account_manager", "ACCOUNT_MANAGER_EMAILS"],
  ["employee", "EMPLOYEE_EMAILS"],
  ["contractor", "CONTRACTOR_EMAILS"],
  ["contractor", "ALLOWED_EMAILS"],
]) {
  for (const email of (process.env[key] ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean)) {
    if (!environmentRoles.has(email)) environmentRoles.set(email, role)
  }
}
const patrons = identityRows.flatMap(row => {
  const email = String(row.email).toLowerCase()
  const role = String(row.managed_role || environmentRoles.get(email) || "contractor")
  if (row.access_status && row.access_status !== "active") return []
  if (!String(row.official_name).trim() || String(row.official_name).startsWith("Name Not Set")) return []
  return [{ email, name: String(row.official_name), role, contractorNumber: row.contractor_number ? String(row.contractor_number) : null }]
})
if (!patrons.some(person => person.name === "Maurice Baraza") || !patrons.some(person => person.name === "Maurice Otieno")) {
  throw new Error("Expected Maurice Baraza and Maurice Otieno to be active, registered patrons; no data was written.")
}
const reviewers = patrons.filter(person => person.role === "account_manager" || person.role === "admin")
if (!reviewers.length) throw new Error("No active account manager or administrator can be assigned as reviewer.")

const months = Array.from({ length: 10 }, (_, index) => {
  const month = index + 1
  const startDate = `2026-${String(month).padStart(2, "0")}-01`
  const endDate = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10)
  const label = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 1)))
  return { name: `${label} 2026`, startDate, endDate }
})
const currentPeriods = await sql`SELECT id::text,name,start_date::text AS start_date,end_date::text AS end_date FROM timesheet_periods`
for (const month of months) {
  const exact = currentPeriods.find(period => period.start_date === month.startDate && period.end_date === month.endDate)
  const overlap = currentPeriods.find(period => period.start_date <= month.endDate && period.end_date >= month.startDate && period.id !== exact?.id)
  if (!exact && overlap) throw new Error(`Period ${month.name} overlaps existing period ${overlap.name}; no demo entries were written.`)
}

const existingNames = new Set(currentPeriods.map(period => period.name))
const missingPeriods = months.filter(month => !currentPeriods.some(period => period.start_date === month.startDate && period.end_date === month.endDate))

const projects = ["Client onboarding", "Operations planning", "Systems integration", "Quality review", "Field service", "Documentation", "Release testing", "Compliance checks", "Equipment inspection", "Training support"]
const tasks = ["Implementation and coordination", "Testing and issue follow-up", "Documentation and handover"]
const entryRows = months.flatMap((period, periodIndex) => patrons.flatMap((patron, patronIndex) => {
  const reviewerCandidates = reviewers.filter(reviewer => reviewer.email !== patron.email)
  const preferred = reviewerCandidates.filter(reviewer => reviewer.role === "account_manager")
  const reviewer = (preferred.length ? preferred : reviewerCandidates)[(periodIndex + patronIndex) % Math.max(1, (preferred.length || reviewerCandidates.length))]
  if (!reviewer) throw new Error(`No independent reviewer available for ${patron.name}.`)
  return [5, 14, 23].map((day, workIndex) => ({
    owner: patron.email,
    contractor: patron.name,
    contractorNumber: patron.contractorNumber,
    reviewer: reviewer.email,
    date: `${period.startDate.slice(0, 8)}${String(Math.min(day, Number(period.endDate.slice(-2)))).padStart(2, "0")}`,
    hours: [2, 3.5, 1.25][(periodIndex + workIndex) % 3],
    project: projects[(periodIndex + patronIndex + workIndex) % projects.length],
    description: `[DEMO TIMESHEET ${period.startDate.slice(0, 7)}] ${tasks[(patronIndex + workIndex) % tasks.length]}`,
  }))
}))

if (process.env.DEMO_SEED_DRY_RUN === "true") {
  console.log(JSON.stringify({
    target: "development",
    periodsToCreate: missingPeriods.map(({ name, startDate, endDate }) => ({ name, startDate, endDate })),
    patrons: patrons.map(({ name, role }) => ({ name, role })),
    demoEntriesToCreate: entryRows.length,
    existingPeriodNamesKept: [...existingNames],
  }, null, 2))
  process.exit(0)
}
if (missingPeriods.length) {
  await sql.transaction(missingPeriods.map(period => sql`INSERT INTO timesheet_periods
    (name,start_date,end_date,submission_deadline,manager_grace_days,reminder_days,created_by)
    VALUES (${period.name},${period.startDate}::date,${period.endDate}::date,${`${period.endDate}T23:59:00.000Z`}::timestamptz,3,3,'demo-seed@tanovo-time.local')`))
}

let createdEntries = 0
for (let offset = 0; offset < entryRows.length; offset += 50) {
  const batch = entryRows.slice(offset, offset + 50)
  const results = await sql.transaction(batch.map(entry => sql`INSERT INTO time_entries
    (contractor,work_date,hours,project,description,owner_email,contractor_number,review_manager_email,status)
    SELECT ${entry.contractor},${entry.date}::date,${entry.hours},${entry.project},${entry.description},${entry.owner},${entry.contractorNumber},${entry.reviewer},'draft'
    WHERE NOT EXISTS(SELECT 1 FROM time_entries WHERE lower(owner_email)=lower(${entry.owner}) AND work_date=${entry.date}::date AND project=${entry.project} AND description=${entry.description})
    RETURNING id`))
  createdEntries += results.filter(rows => rows.length > 0).length
}

const finalPeriods = await sql`SELECT count(*)::int AS count FROM timesheet_periods WHERE start_date >= '2026-01-01' AND end_date <= '2026-10-31'`
const demoRows = await sql`SELECT a.official_name AS name,count(e.id)::int AS entries,count(DISTINCT date_trunc('month',e.work_date))::int AS periods,
    count(e.id) FILTER(WHERE e.review_manager_email IS NOT NULL)::int AS assigned_reviewers
  FROM account_identities a LEFT JOIN time_entries e ON lower(e.owner_email)=lower(a.email) AND e.description LIKE '[DEMO TIMESHEET %'
  WHERE a.official_name=ANY(${patrons.map(person => person.name)}::text[])
  GROUP BY a.official_name ORDER BY a.official_name`
const verifiedEntries = demoRows.reduce((sum, row) => sum + Number(row.entries), 0)
if (Number(finalPeriods[0]?.count ?? 0) !== 10 || verifiedEntries !== entryRows.length || demoRows.some(row => Number(row.periods) !== 10 || Number(row.assigned_reviewers) !== Number(row.entries))) {
  throw new Error("Demo data verification failed after seeding; rerun the idempotent seed after reviewing the development database.")
}
console.log(JSON.stringify({
  periodsPresent: Number(finalPeriods[0]?.count ?? 0),
  periodsCreated: missingPeriods.length,
  patrons: patrons.map(({ name, role }) => ({ name, role, entries: Number(demoRows.find(row => row.name === name)?.entries ?? 0), periods: Number(demoRows.find(row => row.name === name)?.periods ?? 0) })),
  demoEntriesCreated: createdEntries,
  demoEntriesPerPatronPerPeriod: 3,
  existingPeriodNamesKept: [...existingNames],
}, null, 2))
