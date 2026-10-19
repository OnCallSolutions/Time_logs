/**
 * Tests additive rights and explicit revocation independently of role names.
 * Denied accounts cannot regain permissions through stored administrator grants.
 */
import { expect, it } from "vitest"
import { resolvePermissions } from "./permissions"
it("retains existing defaults and supports explicit revocation",()=>{
  expect(resolvePermissions("manager").review_entries).toBe(true)
  expect(resolvePermissions("manager",{review_entries:false}).review_entries).toBe(false)
  expect(resolvePermissions("employee",{review_entries:true}).review_entries).toBe(true)
})
it("does not grant rights to denied accounts",()=>{
  expect(Object.values(resolvePermissions(null,{view_team:true,review_entries:true})).every(value=>!value)).toBe(true)
})
it("gives admins the full timesheet controls while preserving payout authorization as a separate right",()=>{
  const permissions=resolvePermissions("admin")
  expect(permissions).toMatchObject({create_entries:true,edit_entries:true,delete_entries:true,submit_entries:true,review_entries:true,view_team:true,view_reports:true,export_entries:true,view_accounts:true,review_accounts:true,ai_accounts:true,authorize_payouts:false,manage_timesheet_periods:true})
})
it("allows account managers to control periods by default but not managers",()=>{
  expect(resolvePermissions("account_manager").manage_timesheet_periods).toBe(true)
  expect(resolvePermissions("account_manager").manage_projects).toBe(true)
  expect(resolvePermissions("account_manager",{manage_timesheet_periods:false}).manage_timesheet_periods).toBe(false)
  expect(resolvePermissions("account_manager",{manage_projects:false}).manage_projects).toBe(false)
  expect(resolvePermissions("manager").manage_timesheet_periods).toBe(false)
})
it("gives account managers read-only access to all timesheets by default and allows admin revocation",()=>{
  expect(resolvePermissions("account_manager").view_all_timesheets).toBe(true)
  expect(resolvePermissions("account_manager",{view_all_timesheets:false}).view_all_timesheets).toBe(false)
  expect(resolvePermissions("admin").view_all_timesheets).toBe(true)
  expect(resolvePermissions("contractor").view_all_timesheets).toBe(false)
})
it("lets account managers manage their own entries and review the final queue",()=>{
  expect(resolvePermissions("account_manager").review_entries).toBe(true)
  expect(resolvePermissions("account_manager",{review_entries:false}).review_entries).toBe(false)
  expect(resolvePermissions("account_manager")).toMatchObject({create_entries:true,edit_entries:true,delete_entries:false,submit_entries:true})
})
it("gives account managers final-approval access but keeps AI and payout rights separate",()=>{
  expect(resolvePermissions("account_manager")).toMatchObject({view_accounts:true,review_accounts:true,ai_accounts:false,authorize_payouts:false})
  expect(resolvePermissions("account_manager",{view_accounts:false,review_accounts:false})).toMatchObject({view_accounts:false,review_accounts:false})
})
it("keeps project management with managers while making contractor project creation explicitly delegable",()=>{
  expect(resolvePermissions("manager")).toMatchObject({manage_projects:true,create_projects:true})
  expect(resolvePermissions("contractor")).toMatchObject({manage_projects:false,create_projects:false})
  expect(resolvePermissions("contractor",{create_projects:true}).create_projects).toBe(true)
})
