/** Stores non-sensitive in-app deadline reminders; no private message keys are needed. */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { actorRoster } from "@/lib/collaboration"
import { ensureAuditEventsTable, ensureProjectsTable, ensureTimesheetPeriodsTable } from "@/lib/db"
import { createDatabaseInitializer } from "@/lib/database-initializer"
import type { AuditContext } from "@/lib/audit"

const sql=neon(process.env.DATABASE_URL!)
const initialize=createDatabaseInitializer()
const policyInitializer=createDatabaseInitializer()
export type TimesheetReminderPolicy={mode:"automatic"|"manual";timezone:string;workerInitialTime:string;workerHardTime:string;managerInitialTime:string;managerHardTime:string;accountManagerTime:string;updatedBy:string|null;updatedAt:string|null}

export async function ensureReminderPolicy(){
  await policyInitializer(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS timesheet_reminder_policy(
      id text PRIMARY KEY CHECK(id='organization'),mode text NOT NULL DEFAULT 'automatic' CHECK(mode IN ('automatic','manual')),
      timezone text NOT NULL DEFAULT 'America/New_York',worker_initial_time time NOT NULL DEFAULT '17:00',worker_hard_time time NOT NULL DEFAULT '08:00',
      manager_initial_time time NOT NULL DEFAULT '08:00',manager_hard_time time NOT NULL DEFAULT '08:00',account_manager_time time NOT NULL DEFAULT '08:00',
      updated_by text,updated_at timestamptz NOT NULL DEFAULT now())`
    await sql`INSERT INTO timesheet_reminder_policy(id) VALUES('organization') ON CONFLICT(id) DO NOTHING`
  })
}

export async function getTimesheetReminderPolicy():Promise<TimesheetReminderPolicy>{
  await ensureReminderPolicy()
  const rows=await sql`SELECT mode,timezone,to_char(worker_initial_time,'HH24:MI') AS worker_initial_time,to_char(worker_hard_time,'HH24:MI') AS worker_hard_time,to_char(manager_initial_time,'HH24:MI') AS manager_initial_time,to_char(manager_hard_time,'HH24:MI') AS manager_hard_time,to_char(account_manager_time,'HH24:MI') AS account_manager_time,updated_by,updated_at::text AS updated_at FROM timesheet_reminder_policy WHERE id='organization'`
  const row=rows[0]!
  return {mode:String(row.mode) as TimesheetReminderPolicy["mode"],timezone:String(row.timezone),workerInitialTime:String(row.worker_initial_time),workerHardTime:String(row.worker_hard_time),managerInitialTime:String(row.manager_initial_time),managerHardTime:String(row.manager_hard_time),accountManagerTime:String(row.account_manager_time),updatedBy:row.updated_by?String(row.updated_by):null,updatedAt:row.updated_at?new Date(String(row.updated_at)).toISOString():null}
}

export async function updateTimesheetReminderPolicy(input:Omit<TimesheetReminderPolicy,"updatedBy"|"updatedAt">,actor:string,context:AuditContext):Promise<TimesheetReminderPolicy>{
  await ensureReminderPolicy();await ensureAuditEventsTable()
  const rows=await sql`WITH saved AS (
    UPDATE timesheet_reminder_policy SET mode=${input.mode},timezone=${input.timezone},worker_initial_time=${input.workerInitialTime}::time,worker_hard_time=${input.workerHardTime}::time,
      manager_initial_time=${input.managerInitialTime}::time,manager_hard_time=${input.managerHardTime}::time,account_manager_time=${input.accountManagerTime}::time,updated_by=lower(${actor}),updated_at=now()
    WHERE id='organization' RETURNING *)
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,ip_address,user_agent,request_method,request_path,request_id)
    SELECT lower(${actor}),'timesheet_reminder_policy_updated','timesheet_reminder_policy','organization',jsonb_build_object('mode',mode,'timezone',timezone,'workerInitialTime',worker_initial_time,'workerHardTime',worker_hard_time,'managerInitialTime',manager_initial_time,'managerHardTime',manager_hard_time,'accountManagerTime',account_manager_time),
      ${context.ipAddress},${context.userAgent},${context.requestMethod},${context.requestPath},${context.requestId} FROM saved RETURNING id`
  if(!rows.length)throw new Error("Reminder settings could not be audited.")
  return getTimesheetReminderPolicy()
}

export async function getCurrentSubmissionCompliance(){
  await ensureTimesheetPeriodsTable();await ensureProjectsTable();await ensureReminders();await ensureAuditEventsTable()
  const rows=await sql`WITH period AS (
    SELECT id,name,start_date,end_date,submission_deadline FROM timesheet_periods WHERE start_date<=CURRENT_DATE ORDER BY start_date DESC LIMIT 1
  ),expected AS (
    SELECT lower(a.patron_email) AS email,array_agg(DISTINCT p.name ORDER BY p.name) AS projects,
      max(CASE WHEN lower(a.assigned_by)<>lower(a.patron_email) THEN lower(a.assigned_by) END) AS assigned_by
    FROM time_project_assignments a JOIN time_projects p ON p.id=a.project_id CROSS JOIN period
    WHERE p.active GROUP BY lower(a.patron_email)
  ),submissions AS (
    SELECT lower(e.owner_email) AS email,max(a.occurred_at) AS submitted_at
    FROM time_entries e JOIN period p ON e.work_date BETWEEN p.start_date AND p.end_date
    JOIN audit_events a ON a.target_type='time_entry' AND a.target_id=e.id::text AND a.action='entry_submitted'
    GROUP BY lower(e.owner_email)
  ) SELECT p.id AS period_id,p.name AS period_name,p.start_date::text AS start_date,p.end_date::text AS end_date,p.submission_deadline::text AS due_at,
      e.email,e.projects,e.assigned_by,s.submitted_at::text AS submitted_at,
      EXISTS(SELECT 1 FROM timesheet_period_reminders r WHERE r.period_id=p.id AND r.reminder_stage='worker_hard_'||e.email) AS hard_reminder_sent,
      EXISTS(SELECT 1 FROM timesheet_period_reminders r WHERE r.period_id=p.id AND r.reminder_stage='manual_worker_hard_'||e.email) AS manual_hard_reminder_pending
    FROM period p JOIN expected e ON true LEFT JOIN submissions s ON s.email=e.email ORDER BY (s.submitted_at IS NULL) DESC,e.email`
  const roster=await actorRoster()
  const activePeople=roster.filter(person=>person.accessStatus==="active")
  const managerNames=new Map(activePeople.filter(person=>person.role==="manager").map(person=>[person.email.toLowerCase(),person.displayName||person.email]))
  const patronNames=new Map(activePeople.map(person=>[person.email.toLowerCase(),person.displayName||person.email]))
  return rows.map(row=>{
    const submittedAt=row.submitted_at?new Date(String(row.submitted_at)).toISOString():null
    const dueAt=new Date(String(row.due_at)).toISOString()
    const late=!!submittedAt&&Date.parse(submittedAt)>Date.parse(dueAt)
    const email=String(row.email)
    const managerEmail=row.assigned_by&&managerNames.has(String(row.assigned_by).toLowerCase())?String(row.assigned_by):null
    const status=!submittedAt?(Date.now()>Date.parse(dueAt)?"overdue":"missing"):late?"late":"submitted"
    return {periodId:String(row.period_id),periodName:String(row.period_name),startDate:String(row.start_date),endDate:String(row.end_date),dueAt,email,displayName:patronNames.get(email.toLowerCase())??email,projects:Array.isArray(row.projects)?row.projects.map(String):[],managerEmail,managerName:managerEmail?managerNames.get(managerEmail.toLowerCase())??managerEmail:null,submittedAt,status,hardReminderSent:Boolean(row.hard_reminder_sent),manualHardReminderPending:Boolean(row.manual_hard_reminder_pending)}
  })
}
export async function ensureReminders(){
  await ensureTimesheetPeriodsTable()
  await initialize(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS timesheet_period_reminders(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period_id uuid NOT NULL REFERENCES timesheet_periods(id) ON DELETE CASCADE,
      recipient_email text NOT NULL,reminder_stage text NOT NULL DEFAULT 'worker_initial',sender_label text NOT NULL DEFAULT 'Business Accounts',title text NOT NULL,body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,UNIQUE(period_id,recipient_email,reminder_stage))`
    await sql`ALTER TABLE timesheet_period_reminders ADD COLUMN IF NOT EXISTS reminder_stage text NOT NULL DEFAULT 'worker_initial'`
    await sql`ALTER TABLE timesheet_period_reminders DROP CONSTRAINT IF EXISTS timesheet_period_reminders_period_id_recipient_email_key`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS timesheet_period_reminders_stage_recipient_idx ON timesheet_period_reminders(period_id,lower(recipient_email),reminder_stage)`
    await sql`CREATE INDEX IF NOT EXISTS timesheet_period_reminders_recipient_idx ON timesheet_period_reminders(recipient_email,created_at DESC)`
  })
}

function localParts(value:string|Date,timezone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value))
  const part=(key:string)=>parts.find(item=>item.type===key)?.value??"00"
  return {year:Number(part("year")),month:Number(part("month")),day:Number(part("day")),hour:Number(part("hour")),minute:Number(part("minute"))}
}
function reminderAt(deadline:string|Date,daysBefore:number,time:string,timezone:string){
  const local=localParts(deadline,timezone),date=new Date(Date.UTC(local.year,local.month-1,local.day-daysBefore))
  const [hour,minute]=time.split(":").map(Number)
  const targetLocal=`${date.toISOString().slice(0,10)}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`
  const nominal=Date.parse(`${targetLocal}:00Z`)
  const actual=localParts(new Date(nominal),timezone)
  const offset=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute)-nominal
  return new Date(nominal-offset)
}
function isDue(target:Date,now:Date,force:boolean){
  return now>=target&&(force?now.getTime()-target.getTime()<=7*86_400_000:now.getTime()-target.getTime()<15*60_000)
}

async function hasActiveProject(email:string):Promise<boolean>{
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM time_project_assignments a JOIN time_projects p ON p.id=a.project_id WHERE p.active AND lower(a.patron_email)=lower(${email})) AS assigned`
  return Boolean(rows[0]?.assigned)
}
async function hasSubmittedBy(email:string,period:{id:string;start_date:string;end_date:string},cutoff:Date):Promise<boolean>{
  const rows=await sql`SELECT EXISTS(SELECT 1 FROM time_entries e JOIN audit_events a ON a.target_type='time_entry' AND a.target_id=e.id::text AND a.action='entry_submitted'
    WHERE lower(e.owner_email)=lower(${email}) AND e.work_date BETWEEN ${period.start_date}::date AND ${period.end_date}::date AND a.occurred_at<=${cutoff.toISOString()}::timestamptz) AS submitted`
  return Boolean(rows[0]?.submitted)
}
async function createReminder(periodId:string,recipient:string,stage:string,title:string,body:string,actor:string):Promise<number>{
  await ensureAuditEventsTable()
  const rows=await sql`WITH created AS (
    INSERT INTO timesheet_period_reminders(period_id,recipient_email,reminder_stage,title,body)
    VALUES(${periodId}::uuid,lower(${recipient}),${stage},${title},${body}) ON CONFLICT DO NOTHING RETURNING id,recipient_email,reminder_stage
  ),audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata,request_method,request_path)
      SELECT lower(${actor}),${stage.startsWith('worker_hard')||stage.startsWith('manager_hard')?'timesheet_hard_reminder_sent':'timesheet_reminder_sent'},'timesheet_period_reminder',id::text,
      jsonb_build_object('recipient',recipient_email,'stage',reminder_stage,'periodId',${periodId}), 'CRON','/api/timesheet-period-reminders' FROM created RETURNING target_id
  ) SELECT id FROM created WHERE EXISTS(SELECT 1 FROM audited)`
  return rows.length
}

/** Applies role-specific initial and hard reminders against each period's staged deadlines. */
export async function sendDueTimesheetReminders(forceManual=false,manualActor="system@tanovo-time.local"):Promise<number>{
  await ensureReminders();await ensureTimesheetPeriodsTable()
  const policy=await getTimesheetReminderPolicy()
  const now=new Date(),roster=(await actorRoster()).filter(actor=>actor.accessStatus==="active")
  const workers=roster.filter(actor=>actor.role==="employee"||actor.role==="contractor")
  const managers=roster.filter(actor=>actor.role==="manager")
  const accountManagers=roster.filter(actor=>actor.role==="account_manager")
  const periods=await sql`SELECT id,name,start_date::text AS start_date,end_date::text AS end_date,submission_deadline::text AS submission_deadline,
    manager_submission_deadline::text AS manager_submission_deadline,account_approval_deadline::text AS account_approval_deadline,
    exception_resolution_deadline::text AS exception_resolution_deadline,reminder_days,timezone FROM timesheet_periods WHERE end_date>=CURRENT_DATE-7`
  let sent=0
  const actor=forceManual?manualActor:"system@tanovo-time.local"
  for(const period of periods){
    const zone=String(period.timezone||policy.timezone),name=String(period.name)
    const workerInitial=reminderAt(String(period.submission_deadline),Number(period.reminder_days),policy.workerInitialTime,zone)
    const workerHard=reminderAt(String(period.submission_deadline),0,policy.workerHardTime,zone)
    const managerInitial=reminderAt(String(period.submission_deadline),0,policy.managerInitialTime,zone)
    const managerHard=reminderAt(String(period.manager_submission_deadline),0,policy.managerHardTime,zone)
    const accountNotice=reminderAt(String(period.account_approval_deadline),0,policy.accountManagerTime,zone)
    const exceptionNotice=reminderAt(String(period.exception_resolution_deadline),0,policy.accountManagerTime,zone)
    const stages=[
      {key:"worker_initial",target:workerInitial,recipients:workers,title:"Timesheet due soon",body:`${name} timesheets are due ${new Date(String(period.submission_deadline)).toLocaleString("en-US",{timeZone:zone,dateStyle:"medium",timeStyle:"short"})}.`},
      {key:"manager_initial",target:managerInitial,recipients:managers,title:"Review window is open",body:`${name} timesheets are due to accounts on ${new Date(String(period.account_approval_deadline)).toLocaleString("en-US",{timeZone:zone,dateStyle:"medium",timeStyle:"short"})}. Review your team and submit your own entries.`},
      {key:"account_approval",target:accountNotice,recipients:accountManagers,title:"Account approval deadline",body:`Manager submissions for ${name} are due. Complete approvals, returns, and reapprovals by ${new Date(String(period.account_approval_deadline)).toLocaleString("en-US",{timeZone:zone,dateStyle:"medium",timeStyle:"short"})}.`},
      {key:"exception_resolution",target:exceptionNotice,recipients:accountManagers,title:"Exception resolution cutoff",body:`Resolve outstanding ${name} timesheet issues by ${new Date(String(period.exception_resolution_deadline)).toLocaleString("en-US",{timeZone:zone,dateStyle:"medium",timeStyle:"short"})}.`},
    ]
    for(const stage of stages){
      if(!isDue(stage.target,now,forceManual))continue
      if(policy.mode==="manual"&&!forceManual){for(const reviewer of accountManagers)sent+=await createReminder(String(period.id),reviewer.email,`manual_${stage.key}`,"Timesheet reminders need attention",`Manual mode: send ${stage.key.replaceAll("_"," ")} reminders for ${name}.`,actor);continue}
      for(const recipient of stage.recipients){
        sent+=await createReminder(String(period.id),recipient.email,stage.key,stage.title,stage.body,actor)
      }
    }
    const workerCutoff=new Date(workerHard.getTime()-15*60_000)
    if(isDue(workerHard,now,forceManual))for(const worker of workers){
      if(!await hasActiveProject(worker.email)||await hasSubmittedBy(worker.email,period as {id:string;start_date:string;end_date:string},workerCutoff))continue
      const assignment=await sql`SELECT DISTINCT lower(a.assigned_by) AS assigned_by,lower(p.created_by) AS created_by FROM time_project_assignments a JOIN time_projects p ON p.id=a.project_id WHERE p.active AND lower(a.patron_email)=lower(${worker.email})`
      const assignedManagers=[...new Set(assignment.flatMap(row=>[String(row.assigned_by),String(row.created_by)]).filter(email=>managers.some(manager=>manager.email.toLowerCase()===email)))]
      const recipients=assignedManagers.length?assignedManagers:accountManagers.slice(0,1).map(person=>person.email.toLowerCase())
      if(policy.mode==="manual"&&!forceManual){for(const reviewer of accountManagers)sent+=await createReminder(String(period.id),reviewer.email,`manual_worker_hard_${worker.email.toLowerCase()}`,"Manual hard reminder is due",`Send the overdue ${name} timesheet reminder to ${worker.displayName||worker.email}${recipients.length?` via ${recipients.join(", ")}`:"; no assigned manager was found"}.`,actor)}
      else for(const recipient of recipients)sent+=await createReminder(String(period.id),recipient,`worker_hard_${worker.email.toLowerCase()}`,"Hard reminder: timesheet missing",`${worker.displayName||worker.email} has not submitted a timesheet for ${name}; an active project assignment remains.`,actor)
    }
    const managerCutoff=new Date(managerHard.getTime()-15*60_000)
    if(isDue(managerHard,now,forceManual))for(const manager of managers){
      if(!await hasActiveProject(manager.email)||await hasSubmittedBy(manager.email,period as {id:string;start_date:string;end_date:string},managerCutoff))continue
      for(const reviewer of accountManagers){
        const stage=policy.mode==="manual"&&!forceManual?`manual_manager_hard_${manager.email.toLowerCase()}`:`manager_hard_${manager.email.toLowerCase()}`
        sent+=await createReminder(String(period.id),reviewer.email,stage,policy.mode==="manual"&&!forceManual?"Manual manager reminder is due":"Hard reminder: manager timesheet missing",`${manager.displayName||manager.email} has not submitted a timesheet for ${name} by the manager cutoff.`,actor)
      }
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
