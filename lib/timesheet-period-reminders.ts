/** Stores non-sensitive in-app deadline reminders; no private message keys are needed. */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { actorRoster } from "@/lib/collaboration"
import { ensureTimesheetPeriodsTable } from "@/lib/db"
import { createDatabaseInitializer } from "@/lib/database-initializer"

const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
async function ensureReminders(){
  await ensureTimesheetPeriodsTable()
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS timesheet_period_reminders(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period_id uuid NOT NULL REFERENCES timesheet_periods(id) ON DELETE CASCADE,
      recipient_email text NOT NULL,sender_label text NOT NULL DEFAULT 'Business Accounts',title text NOT NULL,body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,UNIQUE(period_id,recipient_email))`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_period_reminders_recipient_idx ON timesheet_period_reminders(recipient_email,created_at DESC)`
  })
}

/** Creates idempotent account-management reminders on the configured UTC reminder date. */
export async function sendDueTimesheetReminders():Promise<number>{
  await ensureReminders()
  const roster=(await actorRoster()).filter(actor=>actor.accessStatus==="active"&&actor.role!=="none")
  const periods=await sql`SELECT id,name,submission_deadline::text AS submission_deadline,reminder_days
    FROM timesheet_periods WHERE submission_deadline > now()
      AND (submission_deadline AT TIME ZONE 'UTC')::date - reminder_days = (now() AT TIME ZONE 'UTC')::date`
  let sent=0
  for(const period of periods){
    for(const actor of roster){
      const rows=await sql`INSERT INTO timesheet_period_reminders(period_id,recipient_email,title,body)
        VALUES(${period.id},${actor.email.toLowerCase()},'Timesheet deadline approaching',
          ${`${String(period.name)} timesheets are due ${new Date(String(period.submission_deadline)).toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})} UTC. Submit entries or contact your manager about an extension.`})
        ON CONFLICT(period_id,recipient_email) DO NOTHING RETURNING id`
      sent+=rows.length
    }
  }
  return sent
}

/** @returns Latest account-scoped period notifications with read state. */
export async function listTimesheetReminders(email:string){
  await ensureReminders()
  return await sql`SELECT id,title,body,sender_label,created_at::text AS created_at,read_at::text AS read_at
    FROM timesheet_period_reminders WHERE recipient_email=${email.toLowerCase()} ORDER BY created_at DESC LIMIT 100`
}

/** Marks only the authenticated recipient's bounded notification selection as read. */
export async function markTimesheetRemindersRead(email:string,ids:string[]):Promise<void>{
  await ensureReminders()
  if(!ids.length||ids.length>100)return
  await sql`UPDATE timesheet_period_reminders SET read_at=COALESCE(read_at,now())
    WHERE recipient_email=${email.toLowerCase()} AND id=ANY(${ids}::uuid[])`
}
