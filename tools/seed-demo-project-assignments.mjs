import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { neon } from "@neondatabase/serverless"

const root=process.cwd()
for(const file of [".env.local",".env.development.local",".env"]){
  try{for(const line of readFileSync(resolve(root,file),"utf8").split(/\r?\n/)){const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(!match||process.env[match[1]])continue;process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/, "$2")}}catch{}
}
if(process.env.DEMO_SEED_TARGET!=="development"||process.env.TANOVO_DATABASE_ENVIRONMENT!=="development"||process.env.VERCEL_ENV==="production"||process.env.NODE_ENV==="production")throw new Error("Demo project assignments require DEMO_SEED_TARGET=development, TANOVO_DATABASE_ENVIRONMENT=development, and a non-production runtime.")
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not configured.")
const sql=neon(process.env.DATABASE_URL)
const roleByEmail=new Map()
for(const [role,key] of [["admin","ADMIN_EMAILS"],["manager","MANAGER_EMAILS"],["account_manager","ACCOUNT_MANAGER_EMAILS"],["employee","EMPLOYEE_EMAILS"],["contractor","CONTRACTOR_EMAILS"],["contractor","ALLOWED_EMAILS"]])for(const email of (process.env[key]??"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean))if(!roleByEmail.has(email))roleByEmail.set(email,role)
const identities=await sql`SELECT lower(a.email) AS email,a.official_name,lower(a.created_by) AS created_by,lower(m.role) AS managed_role,m.access_status
  FROM account_identities a LEFT JOIN managed_user_access m ON lower(m.email)=lower(a.email)`
const active=identities.filter(user=>!user.access_status||user.access_status==="active")
const managers=active.filter(user=>(user.managed_role||roleByEmail.get(user.email))==="manager")
if(!managers.length)throw new Error("No active manager is available to own the demo project assignments.")
const manager=managers.sort((a,b)=>String(a.official_name).localeCompare(String(b.official_name)))[0]
const contractors=new Set(active.filter(user=>(user.managed_role||roleByEmail.get(user.email))==="contractor").map(user=>user.email))
const demoRows=await sql`SELECT DISTINCT lower(owner_email) AS email,trim(project) AS project FROM time_entries
  WHERE owner_email IS NOT NULL AND description LIKE '[DEMO TIMESHEET %' AND length(trim(project)) BETWEEN 1 AND 120 ORDER BY lower(owner_email),trim(project)`
const pairs=demoRows.filter(row=>contractors.has(row.email))
if(!pairs.length)throw new Error("No synthetic demo timesheet projects were found for active contractors; no assignments were written.")
const projects=[...new Set(pairs.map(row=>row.project))]
if(process.env.DEMO_SEED_DRY_RUN==="true"){
  console.log(JSON.stringify({target:"development",manager:{name:manager.official_name,email:manager.email},contractors:[...new Set(pairs.map(row=>row.email))],projects,assignments:pairs.length,dryRun:true},null,2))
  process.exit(0)
}

await sql`CREATE TABLE IF NOT EXISTS time_projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),description text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`
await sql`CREATE UNIQUE INDEX IF NOT EXISTS time_projects_name_ci_idx ON time_projects(lower(name))`
await sql`CREATE TABLE IF NOT EXISTS time_project_assignments(project_id uuid NOT NULL REFERENCES time_projects(id) ON DELETE CASCADE,patron_email text NOT NULL,assigned_by text NOT NULL,assigned_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'active',PRIMARY KEY(project_id,patron_email))`
await sql`ALTER TABLE time_project_assignments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`
await sql`CREATE TABLE IF NOT EXISTS time_project_assignment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL,project_name text NOT NULL,patron_email text NOT NULL,action text NOT NULL,actor_email text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now())`
await sql`ALTER TABLE time_project_assignment_events DROP CONSTRAINT IF EXISTS time_project_assignment_events_action_check`
await sql`ALTER TABLE time_project_assignment_events ADD CONSTRAINT time_project_assignment_events_action_check CHECK(action IN ('assigned','reassigned','removed','paused','resumed'))`
await sql`CREATE TABLE IF NOT EXISTS audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_email text NOT NULL,action text NOT NULL,target_type text NOT NULL,target_id text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,ip_address text,user_agent text,request_method text,request_path text,request_id text,occurred_at timestamptz NOT NULL DEFAULT now())`

for(const project of projects){
  await sql`WITH created AS (
    INSERT INTO time_projects(name,created_by) VALUES(${project},${manager.email}) ON CONFLICT DO NOTHING RETURNING id,name,created_by
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata)
    SELECT lower(${manager.email}),'project_created','time_project',created.id::text,jsonb_build_object('name',created.name,'demoSeed',true) FROM created RETURNING target_id
  ) SELECT created.id FROM created WHERE EXISTS(SELECT 1 FROM audited)`
  const rows=await sql`WITH linked AS (
    INSERT INTO time_project_assignments(project_id,patron_email,assigned_by)
    SELECT id,lower(${manager.email}),lower(${manager.email}) FROM time_projects WHERE lower(name)=lower(${project})
    ON CONFLICT DO NOTHING RETURNING project_id,patron_email,assigned_by,assigned_at
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
    SELECT linked.project_id,p.name,linked.patron_email,'assigned',linked.assigned_by,linked.assigned_at FROM linked JOIN time_projects p ON p.id=linked.project_id RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata)
    SELECT lower(${manager.email}),'project_updated','time_project',linked.project_id::text,jsonb_build_object('patronEmail',linked.patron_email,'demoSeed',true) FROM linked RETURNING target_id
  ) SELECT linked.project_id FROM linked WHERE EXISTS(SELECT 1 FROM history) AND EXISTS(SELECT 1 FROM audited)`
  void rows
}
for(const pair of pairs){
  await sql`WITH linked AS (
    INSERT INTO time_project_assignments(project_id,patron_email,assigned_by)
    SELECT id,lower(${pair.email}),lower(${manager.email}) FROM time_projects WHERE lower(name)=lower(${pair.project})
    ON CONFLICT DO NOTHING RETURNING project_id,patron_email,assigned_by,assigned_at
  ), history AS (
    INSERT INTO time_project_assignment_events(project_id,project_name,patron_email,action,actor_email,occurred_at)
    SELECT linked.project_id,p.name,linked.patron_email,'assigned',linked.assigned_by,linked.assigned_at FROM linked JOIN time_projects p ON p.id=linked.project_id RETURNING project_id
  ), audited AS (
    INSERT INTO audit_events(actor_email,action,target_type,target_id,metadata)
    SELECT lower(${manager.email}),'project_updated','time_project',linked.project_id::text,jsonb_build_object('patronEmail',linked.patron_email,'demoSeed',true) FROM linked RETURNING target_id
  ) SELECT linked.project_id FROM linked WHERE EXISTS(SELECT 1 FROM history) AND EXISTS(SELECT 1 FROM audited)`
}
console.log(JSON.stringify({target:"development",manager:manager.email,contractors:[...new Set(pairs.map(row=>row.email))].length,projects:projects.length,assignments:pairs.length},null,2))
