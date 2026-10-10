/**
 * Defines independent-review routing for operational and manager timesheets.
 * Manager-owned work is reviewed only by authorized account managers.
 * Ownership always uses authenticated email, never the displayed person name.
 */
import type { UserRole } from "./types"
/**
 * Determines whether a reviewer role may decide work belonging to an owner role.
 * @param reviewer - Effective authenticated reviewer role.
 * @param owner - Current effective role of the evidence owner.
 * @returns True for the permitted independent review lane.
 */
export function canReviewRole(reviewer:UserRole|null,owner:UserRole|null):boolean {
  if(!owner)return false
  return owner==="manager"?reviewer==="account_manager":reviewer!=="account_manager"
}
