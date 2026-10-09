/**
 * Verifies business-account role boundaries before financial workflows exist.
 * These cases prevent timesheet and operational approval access through overrides.
 * No payment integration or live database is exercised by this suite.
 */
import { expect, it } from "vitest"
import { resolvePermissions } from "./permissions"

it("keeps account managers out of timesheet and operational approval controls",()=>{
  const permissions=resolvePermissions("account_manager",{
    create_entries:true,edit_entries:true,delete_entries:true,submit_entries:true,
    review_entries:true,ai_review:true,delegate_permissions:true,
  })
  for(const key of ["create_entries","edit_entries","delete_entries","submit_entries","review_entries","ai_review","delegate_permissions"] as const){
    expect(permissions[key]).toBe(false)
  }
})

it("requires explicit admin-assigned visibility instead of automatic team access",()=>{
  expect(resolvePermissions("account_manager").view_team).toBe(false)
  expect(resolvePermissions("account_manager",{view_reports:true}).view_reports).toBe(true)
})
