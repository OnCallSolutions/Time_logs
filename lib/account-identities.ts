/**
 * Stores authoritative company names and immutable account/contractor identifiers.
 * Unique database constraints resolve concurrent duplicate creation safely.
 * Onboarding atomically creates identity and baseline access without manager escalation.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { ensureManagedAccessTable, ensureTimeEntriesTable, ensureUserProfilesTable, type UserProfile } from "./db"
import { createDatabaseInitializer } from "./database-initializer"
import { normalizeEmail, normalizeOfficialName } from "./identity-policy"
import { ensureCompanyDirectory } from "./company-directory"
const sql = neon(process.env.DATABASE_URL!)
const initialize = createDatabaseInitializer()
const normalizeLegacyEntryNames = createDatabaseInitializer()
export type AccountIdentity = { email: string; officialName: string; contractorNumber: string; shortReference?: string; companyCode?: string; employeeId?: string | null }

/** @returns Promise<void> once additive identity storage and immutable identifiers exist. */
export async function ensureAccountIdentities(): Promise<void> {
  await ensureManagedAccessTable()
  await initialize(async () => {
    await sql`CREATE TABLE IF NOT EXISTS account_identities (
      account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(trim(email))),
      official_name text NOT NULL CHECK(length(official_name) BETWEEN 2 AND 80),
      contractor_number text NOT NULL UNIQUE DEFAULT ('TN-'||upper(replace(gen_random_uuid()::text,'-',''))),
      nickname text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS account_identities_name_unique ON account_identities(lower(official_name))`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS account_identities_nickname_unique ON account_identities(lower(nickname)) WHERE nickname IS NOT NULL`
    await sql`CREATE TABLE IF NOT EXISTS account_personal_names(email text PRIMARY KEY,nickname text CHECK(nickname IS NULL OR length(nickname) BETWEEN 2 AND 40))`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS account_personal_names_unique ON account_personal_names(lower(nickname)) WHERE nickname IS NOT NULL`
    await sql`CREATE OR REPLACE FUNCTION protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.account_id<>OLD.account_id OR NEW.contractor_number<>OLD.contractor_number OR NEW.email<>OLD.email THEN
        RAISE EXCEPTION 'Account identifiers cannot be changed' USING ERRCODE='23514';
      END IF; RETURN NEW; END $$`
    await sql`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='account_identity_immutable' AND tgrelid='account_identities'::regclass) THEN
      CREATE TRIGGER account_identity_immutable BEFORE UPDATE ON account_identities FOR EACH ROW EXECUTE FUNCTION protect_account_identity();
      END IF; END $$`
    const existing = await sql`SELECT account_id,official_name FROM account_identities`
    for (const row of existing as { account_id: string; official_name: string }[]) {
      const officialName = normalizeOfficialName(row.official_name)
      if (officialName !== row.official_name) await sql`UPDATE account_identities SET official_name=${officialName},updated_at=now() WHERE account_id=${row.account_id}`
    }
  })
  await ensureCompanyDirectory()
  await ensureTimeEntriesTable()
  await normalizeLegacyEntryNames(async()=>{
    const rows=await sql`SELECT DISTINCT contractor FROM time_entries`
    for(const row of rows as {contractor:string}[]){
      const canonical=normalizeOfficialName(row.contractor)
      if(canonical!==row.contractor)await sql`UPDATE time_entries SET contractor=${canonical} WHERE contractor=${row.contractor}`
    }
  })
}
/**
 * Reads only public official identity fields, never nicknames or the internal UUID.
 * @param emails - Authorized account emails, or undefined for server-side directory assembly.
 * @returns Promise<AccountIdentity[]> containing approved company identifiers.
 */
export async function listAccountIdentities(emails?: string[]): Promise<AccountIdentity[]> {
  await ensureAccountIdentities()
  return await sql`SELECT a.email,a.official_name AS "officialName",a.contractor_number AS "contractorNumber",
    'TN-'||lpad(m.reference_number::text,GREATEST(6,length(m.reference_number::text)),'0') AS "shortReference",
    c.code AS "companyCode",m.employee_id AS "employeeId"
    FROM account_identities a JOIN company_memberships m USING(account_id) JOIN licensed_company c USING(company_id)
    WHERE ${emails === undefined} OR a.email=ANY(${emails?.map(normalizeEmail) ?? []}::text[])` as AccountIdentity[]
}
/**
 * Creates a baseline contractor/employee account without modifying an existing one.
 * @param input - Validated official identity, baseline role, authenticated creator and recovery admins.
 * @returns Promise<AccountIdentity|null> after both identity and access are stored, or null on a conflict.
 */
export async function onboardAccount(input: { email: string; officialName: string; employeeId?: string; role: "contractor" | "employee"; actor: string; environmentAdmins: string[] }): Promise<AccountIdentity | null> {
  await ensureAccountIdentities()
  const rows = await sql`WITH allowed AS (
      SELECT 1 WHERE ${input.environmentAdmins.includes(normalizeEmail(input.actor))} OR EXISTS(
        SELECT 1 FROM managed_user_access WHERE email=${normalizeEmail(input.actor)} AND role IN ('admin','manager') AND access_status='active')
    ), access AS (
      INSERT INTO managed_user_access(email,role,access_status,permissions,updated_by)
      SELECT ${normalizeEmail(input.email)},${input.role},'active','{}'::jsonb,${normalizeEmail(input.actor)} FROM allowed
      ON CONFLICT(email) DO NOTHING RETURNING email
    ), identity AS (INSERT INTO account_identities(email,official_name,created_by)
      SELECT email,${input.officialName},${normalizeEmail(input.actor)} FROM access
      RETURNING account_id)
    INSERT INTO company_memberships(account_id,company_id,employee_id)
      SELECT i.account_id,c.company_id,${input.employeeId || null} FROM identity i CROSS JOIN licensed_company c RETURNING account_id`
  return rows.length ? (await listAccountIdentities([input.email]))[0] ?? null : null
}
/**
 * Sets or corrects an official identity without changing its immutable identifiers.
 * @param email - Existing company account being named by an administrator.
 * @param officialName - Validated, normalized official name.
 * @param actor - Authenticated administrator recorded as the identity creator.
 * @returns Promise<AccountIdentity> with the saved approved identity.
 */
export async function setOfficialIdentity(email: string, officialName: string, actor: string, employeeId?: string): Promise<AccountIdentity> {
  await ensureAccountIdentities()
  await sql`WITH identity AS (INSERT INTO account_identities(email,official_name,created_by) VALUES(${normalizeEmail(email)},${officialName},${normalizeEmail(actor)})
    ON CONFLICT(email) DO UPDATE SET official_name=EXCLUDED.official_name,updated_at=now()
    RETURNING account_id)
    INSERT INTO company_memberships(account_id,company_id,employee_id)
      SELECT i.account_id,c.company_id,${employeeId || null} FROM identity i CROSS JOIN licensed_company c
    ON CONFLICT(account_id) DO UPDATE SET employee_id=CASE WHEN ${employeeId !== undefined} THEN EXCLUDED.employee_id ELSE company_memberships.employee_id END`
  return (await listAccountIdentities([email]))[0]
}
/**
 * Saves a private nickname and avatar with an atomic uniqueness reservation.
 * @param email - Authenticated profile owner, never a company-name editing target.
 * @param profile - Validated personal nickname and bounded image data URL.
 * @returns Promise<UserProfile> containing only the current owner's personal preferences.
 */
export async function savePersonalProfile(email:string,profile:UserProfile):Promise<UserProfile>{
  await ensureAccountIdentities();await ensureUserProfilesTable()
  const rows=await sql`WITH reserved AS (
    INSERT INTO account_personal_names(email,nickname) VALUES(${normalizeEmail(email)},${profile.displayName||null})
    ON CONFLICT(email) DO UPDATE SET nickname=EXCLUDED.nickname RETURNING email
  ) INSERT INTO user_profiles(owner_email,display_name,image_data_url)
    SELECT email,${profile.displayName},${profile.imageDataUrl} FROM reserved
    ON CONFLICT(owner_email) DO UPDATE SET display_name=EXCLUDED.display_name,image_data_url=EXCLUDED.image_data_url,updated_at=now()
    RETURNING display_name AS "displayName",image_data_url AS "imageDataUrl"`
  return rows[0] as UserProfile
}
