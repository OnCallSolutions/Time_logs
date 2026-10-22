/**
 * Verifies business-account manager access to own entries and the final review lane.
 * No payment integration or live database is exercised by this suite.
 */
import { expect, it } from "vitest"
import { resolvePermissions } from "./permissions"

it("allows own timesheet entry work while keeping deletion and delegation disabled",()=>{
  const permissions=resolvePermissions("account_manager",{
    create_entries:true,edit_entries:true,delete_entries:true,submit_entries:true,
    review_entries:true,ai_review:true,delegate_permissions:true,
  })
  expect(permissions).toMatchObject({create_entries:true,edit_entries:true,submit_entries:true,delete_entries:false,ai_review:false,delegate_permissions:false})
  expect(permissions.review_entries).toBe(true)
  expect(resolvePermissions("account_manager",{review_entries:false}).review_entries).toBe(false)
})

it("requires explicit admin-assigned visibility instead of automatic team access",()=>{
  expect(resolvePermissions("account_manager").view_team).toBe(false)
  expect(resolvePermissions("account_manager",{view_reports:true}).view_reports).toBe(true)
})
