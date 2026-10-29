/**
 * Binds this installation to one licensed company and maps account UUIDs to references.
 * Company employee IDs remain externally assigned, optional and company-scoped.
 * This is a single-company deployment boundary, not shared-database tenant isolation.
 */
import "server-only"
import { neon } from "@neondatabase/serverless"
import { z } from "zod"
import { createDatabaseInitializer } from "./database-initializer"
import { employeeIdSchema } from "./identity-policy"
const sql = neon(process.env.DATABASE_URL!)
const initialize = createDatabaseInitializer()

/** @returns Validated server-controlled company branding; never taken from request bodies. */
export function deploymentCompany() {
  return {
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).parse(process.env.COMPANY_CODE || "DEVONCALL"),
    name: z.string().trim().min(2).max(100).parse(process.env.COMPANY_NAME || "DevOnCall"),
  }
}

/**
 * Reads optional organization email domains for a non-blocking membership warning.
 * @returns Unique lower-case domains configured by this licensed deployment.
 */
export function companyEmailDomains(): string[] {
  const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
  return [...new Set((process.env.COMPANY_EMAIL_DOMAINS ?? "").split(",")
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(domain => domainPattern.test(domain)))]
}

/**
 * Creates additive company/membership storage after account_identities exists.
 * A persisted installation binding rejects accidental reuse for a different company.
 * @returns Promise<void> after existing account UUIDs receive stable short references.
 */
export async function ensureCompanyDirectory(): Promise<void> {
  await initialize(async () => {
    const company = deploymentCompany()
    await sql`CREATE TABLE IF NOT EXISTS licensed_company (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      company_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`INSERT INTO licensed_company(code,name) VALUES(${company.code},${company.name}) ON CONFLICT(singleton) DO NOTHING`
    const binding = await sql`SELECT code FROM licensed_company WHERE singleton=true`
    if (binding[0]?.code !== company.code) throw new Error("Company installation binding mismatch.")
    await sql`CREATE TABLE IF NOT EXISTS company_memberships (
      account_id uuid PRIMARY KEY REFERENCES account_identities(account_id),
      company_id uuid NOT NULL REFERENCES licensed_company(company_id),
      reference_number bigserial NOT NULL UNIQUE,
      employee_id text CHECK(employee_id IS NULL OR length(employee_id) BETWEEN 1 AND 64),
      UNIQUE(company_id,employee_id)
    )`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_employee_id_casefold_unique
      ON company_memberships(company_id,lower(employee_id)) WHERE employee_id IS NOT NULL`
    await sql`CREATE OR REPLACE FUNCTION protect_company_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.account_id<>OLD.account_id OR NEW.company_id<>OLD.company_id OR NEW.reference_number<>OLD.reference_number THEN
        RAISE EXCEPTION 'Membership identifiers cannot be changed' USING ERRCODE='23514';
      END IF; RETURN NEW; END $$`
    await sql`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='company_membership_immutable' AND tgrelid='company_memberships'::regclass) THEN
      CREATE TRIGGER company_membership_immutable BEFORE UPDATE ON company_memberships FOR EACH ROW EXECUTE FUNCTION protect_company_membership();
    END IF; END $$`
    await sql`INSERT INTO company_memberships(account_id,company_id)
      SELECT a.account_id,c.company_id FROM account_identities a CROSS JOIN licensed_company c
      ON CONFLICT(account_id) DO NOTHING`
  })
}
