/**
 * Verifies business-account role boundaries before financial workflows exist.
 * Account managers may review assigned workforce submissions but cannot mutate entries.
 * No payment integration or live database is exercised by this suite.
 */
import { expect, it } from "vitest"
import { resolvePermissions } from "./permissions"

it("allows assigned workforce review but keeps entry mutation and delegation disabled",()=>{
  const permissions=resolvePermissions("account_manager",{
    create_entries:true,edit_entries:true,delete_entries:true,submit_entries:true,
    review_entries:true,ai_review:true,delegate_permissions:true,
  })
  for(const key of ["create_entries","edit_entries","delete_entries","submit_entries","ai_review","delegate_permissions"] as const){
    expect(permissions[key]).toBe(false)
  }
  expect(permissions.review_entries).toBe(true)
  expect(resolvePermissions("account_manager",{review_entries:false}).review_entries).toBe(false)
})

it("requires explicit admin-assigned visibility instead of automatic team access",()=>{
  expect(resolvePermissions("account_manager").view_team).toBe(false)
  expect(resolvePermissions("account_manager",{view_reports:true}).view_reports).toBe(true)
})
