/**
 * Defines the explicit failure raised when access changes would strand the app.
 * This shared error contains no database details and is safe to return to admins.
 * Storage enforces the invariant inside a serializable transaction.
 */
export class LastAdministratorError extends Error {
  /**
   * Creates an actionable policy error for a rejected last-admin mutation.
   * @returns LastAdministratorError with a safe administrator-facing message.
   */
  constructor() {
    super("At least one active administrator must remain. Add another admin before changing this account.")
    this.name = "LastAdministratorError"
  }
}

/** Describes the target state evaluated before persisting an access change. */
export type AccessChangeTarget = {
  role: string
  accessStatus: string
  permissions?: Record<string, boolean | undefined>
}

/**
 * Identifies access changes requiring recent Microsoft reauthentication.
 * Admin/manager/business-account authority, account lifecycle transitions, and
 * grants of sensitive workflow or financial rights all require step-up auth.
 * @param current - Persisted role, state, and rights before the proposed change.
 * @param next - Requested role, state, and rights after the proposed change.
 * @returns True when the caller must reauthenticate before saving.
 */
export function accessChangeRequiresStepUp(
  current: AccessChangeTarget | null,
  next: AccessChangeTarget,
): boolean {
  const elevatedRoles = new Set(["admin", "manager", "account_manager"])
  if (!current && elevatedRoles.has(next.role)) return true
  if (current && current.role !== next.role && (elevatedRoles.has(current.role) || elevatedRoles.has(next.role))) return true
  if (current && current.accessStatus !== next.accessStatus) return true

  const highImpactRights = [
    "delegate_permissions",
    "send_to_accounts",
    "view_accounts",
    "review_accounts",
    "ai_accounts",
    "view_manager_entries",
    "review_manager_entries",
    "view_other_manager_entries",
    "review_other_manager_entries",
    "authorize_payouts",
  ]
  return highImpactRights.some(right => !current?.permissions?.[right] && next.permissions?.[right] === true)
}
