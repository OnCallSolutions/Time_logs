/**
 * Defines independent-review routing for operational and manager timesheets.
 * Manager-owned work is reviewed only by authorized account managers.
 * Account managers can operationally review workforce entries only when enabled.
 * Ownership always uses authenticated email, never the displayed person name.
 */
import type { UserRole } from "./types"
import type { Permissions } from "./permissions"
/**
 * Determines whether a reviewer role may decide work belonging to an owner role.
 * @param reviewer - Effective authenticated reviewer role.
 * @param owner - Current effective role of the evidence owner.
 * @param permissions - Live explicit rights for manager-personal review assistance.
 * @returns True for the permitted independent review lane; ownership is checked separately.
 */
export function canReviewRole(reviewer:UserRole|null,owner:UserRole|null,permissions?:Permissions):boolean {
  if(!owner)return false
  return owner==="manager"?(reviewer==="account_manager"||((reviewer==="manager"||reviewer==="admin")&&!!permissions?.view_manager_entries&&!!permissions?.review_manager_entries)):
    reviewer!=="account_manager"||!!permissions?.review_entries
}
