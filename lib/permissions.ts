/**
 * Defines per-control rights and backward-compatible role defaults.
 * Explicit administrator overrides allow or deny rights without changing roles.
 * This shared policy is safe for UI use; database resolution stays server-only.
 */
import type { UserRole } from "@/lib/types"
export const permissionLabels = {
  create_entries: "Create entries and extract notes",
  create_projects: "Create projects when authorized by a manager",
  manage_projects: "Create and manage the organization project catalog",
  edit_entries: "Edit eligible entries",
  delete_entries: "Delete eligible entries",
  submit_entries: "Submit and recall entries",
  review_entries: "Approve and reject assigned workforce entries",
  view_team: "View team entries",
  view_all_timesheets: "View all organization timesheets and period archives",
  view_reports: "View team reports",
  export_entries: "Export visible timesheets",
  ai_review: "Prepare AI review",
  delegate_permissions: "Manage employee/contractor workflow rights",
  send_messages: "Send employee messages",
  send_to_accounts: "Hand approved contractor work to business accounts",
  view_accounts: "View business-accounts dashboard and all handoffs",
  review_accounts: "Triage assigned business-account evidence",
  ai_accounts: "Prepare advisory AI account review",
  view_manager_entries: "View other managers' submitted personal timesheets",
  review_manager_entries: "Approve other managers' submitted personal timesheets",
  view_other_manager_entries: "View submissions assigned to another manager",
  review_other_manager_entries: "Help approve submissions assigned to another manager",
  request_review_help: "Grant temporary review access to selected timesheets",
  accept_review_requests: "Accept scoped review requests from authorized managers",
  authorize_payouts: "Authorize timesheet payout eligibility (no payment transfer)",
  manage_timesheet_periods: "Configure timesheet periods and submission windows",
  view_personal_reports: "View reports for own timesheets",
} as const
export type Permission = keyof typeof permissionLabels
export type PermissionOverrides = Partial<Record<Permission, boolean>>
export type Permissions = Record<Permission, boolean>
/** Operational rights managers may delegate without granting role or financial authority. */
export const delegablePermissions: readonly Permission[] = ["create_entries","create_projects","edit_entries","delete_entries","submit_entries","review_entries","view_team","view_reports"]

/**
 * Resolves role defaults plus explicit rights without granting unknown controls.
 * @param role - Current server-authorized role, or null for denied access.
 * @param overrides - Administrator choices persisted for the account.
 * @returns Permissions containing an allow/deny value for every known control.
 */
export function resolvePermissions(role: UserRole | null, overrides: PermissionOverrides = {}): Permissions {
  const elevated = role === "admin" || role === "manager"
  const personal = role === "employee" || role === "contractor"
  const defaults: Permissions = {create_entries:!!role,create_projects:elevated,manage_projects:elevated||role==="account_manager",edit_entries:!!role,delete_entries:!!role,
    submit_entries:personal||role==="manager"||role==="admin",review_entries:elevated||role==="account_manager",view_team:elevated,view_all_timesheets:role==="admin"||role==="account_manager",view_reports:elevated,export_entries:elevated||role==="account_manager",ai_review:elevated,
    delegate_permissions:elevated,send_messages:elevated,send_to_accounts:elevated,view_accounts:role==="admin"||role==="account_manager",review_accounts:role==="admin"||role==="account_manager",ai_accounts:role==="admin",review_manager_entries:false,view_manager_entries:role==="account_manager",view_other_manager_entries:false,review_other_manager_entries:false,request_review_help:elevated,accept_review_requests:role==="manager",authorize_payouts:false,manage_timesheet_periods:role==="admin"||role==="account_manager",view_personal_reports:!!role}
  for (const key of Object.keys(permissionLabels) as Permission[]) {
    if (role && typeof overrides[key] === "boolean") defaults[key] = overrides[key]!
  }
  // Business-account actors cannot create or edit timesheets. Operational review
  // is separately permission-gated so admins can disable the manager-review lane.
  if (role === "account_manager") {
    defaults.create_entries = false
    defaults.edit_entries = false
    defaults.delete_entries = false
    defaults.submit_entries = false
    defaults.ai_review = false
    defaults.delegate_permissions = false
  }
  if (role !== "admin" && role !== "account_manager") {
    defaults.view_accounts = false
    defaults.review_accounts = false
    defaults.ai_accounts = false
    defaults.authorize_payouts = false
  }
  return defaults
}
