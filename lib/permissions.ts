/**
 * Defines per-control rights and backward-compatible role defaults.
 * Explicit administrator overrides allow or deny rights without changing roles.
 * This shared policy is safe for UI use; database resolution stays server-only.
 */
import type { UserRole } from "@/lib/types"
export const permissionLabels = {
  create_entries: "Create entries and extract notes",
  edit_entries: "Edit eligible entries",
  delete_entries: "Delete eligible entries",
  submit_entries: "Submit and recall entries",
  review_entries: "Approve and reject entries",
  view_team: "View team entries",
  view_reports: "View team reports",
  ai_review: "Prepare AI review",
  delegate_permissions: "Delegate employee workflow rights",
  send_messages: "Send employee messages",
  send_to_accounts: "Hand approved contractor work to business accounts",
  view_accounts: "View assigned business-account handoffs",
} as const
export type Permission = keyof typeof permissionLabels
export type PermissionOverrides = Partial<Record<Permission, boolean>>
export type Permissions = Record<Permission, boolean>

/**
 * Resolves role defaults plus explicit rights without granting unknown controls.
 * @param role - Current server-authorized role, or null for denied access.
 * @param overrides - Administrator choices persisted for the account.
 * @returns Permissions containing an allow/deny value for every known control.
 */
export function resolvePermissions(role: UserRole | null, overrides: PermissionOverrides = {}): Permissions {
  const elevated = role === "admin" || role === "manager"
  const personal = role === "employee" || role === "contractor"
  const defaults: Permissions = {create_entries:!!role,edit_entries:!!role,delete_entries:!!role,
    submit_entries:personal||role==="manager",review_entries:elevated,view_team:elevated,view_reports:elevated,ai_review:elevated,
    delegate_permissions:elevated,send_messages:elevated,send_to_accounts:role==="admin",view_accounts:role==="admin"}
  for (const key of Object.keys(permissionLabels) as Permission[]) {
    if (role && typeof overrides[key] === "boolean") defaults[key] = overrides[key]!
  }
  // Business-account actors cannot mutate timesheets or approve the operational review stage.
  // Financial authorization will use separate, server-enforced permissions when implemented.
  if (role === "account_manager") {
    defaults.create_entries = false
    defaults.edit_entries = false
    defaults.delete_entries = false
    defaults.submit_entries = false
    defaults.review_entries = false
    defaults.ai_review = false
    defaults.delegate_permissions = false
  }
  return defaults
}
