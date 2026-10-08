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
