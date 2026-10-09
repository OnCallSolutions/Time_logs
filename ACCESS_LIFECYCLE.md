# Access Lifecycle and Temporary Assignments

Logic lives on `access_lifecycle`; admin and manager presentation lives on
`user_Interface`. No Entra revocation, live migration, or deployment is performed
by this feature implementation.

## Account Access

Administrators can set an exact UTC cutoff, cancel a cutoff, suspend immediately
with a review date, or explicitly reactivate. Access checks compare the cutoff on
every request; scheduler delays cannot keep an expired account authorized.
Suspension review dates are reminders, not automatic reactivation deadlines.
An already-effective cutoff cannot be canceled or moved into the future to bypass
offboarding. Explicit reactivation is required first.
Existing managed denied/blocked access remains denied after lifecycle reactivation.

Administrators are excluded from automatic lifecycle denial and scheduling. Use
the existing protected role/access workflow to offboard an admin, preserving at
least one active administrator and updating recovery `ADMIN_EMAILS` separately.
If an account with a cutoff is later promoted to admin, that automatic cutoff no
longer applies: review its schedule and use the manual administrator workflow.

## Temporary Duties

Assignments retain the primary role and include explicit permission controls,
scope, start, expiry, grantor, and reason. Supported temporary controls are personal
entry creation/edit/deletion/submission plus operational review and team/report
visibility. Financial, technical-admin, messaging, and AI privileges are excluded.

The initial supported scopes are own-record controls and explicitly whole-application
operational visibility. Project/team-specific scopes are not implemented; whole-
application review can expose all records allowed by current team-visibility policy.
Grant `review_entries` and `view_team` together only when that broad scope is intended.

Managers with delegation permission may assign active employees/contractors only,
and only controls they hold. Admins may assign active operational managers as well.
No assignment can promote a role or bypass a permanent explicit denial. Account
managers/admins do not receive these temporary operational grants. Self-review
prohibitions and account-manager timesheet restrictions still apply.

Starts are inclusive; expiry is exclusive. Expired, revoked, or future grants do not
apply. If a grantor loses account access or their supporting permanent rights,
dependent privileges are withdrawn at resolution. Extensions require an explicit
new expiry, reason, and live authority check; revocation retains assignment history.

Explicit lifecycle reactivation atomically revokes incoming and outgoing temporary
assignments before restoring lifecycle access. Required temporary duties must be
granted again, preventing silent restoration after offboarding or suspension.

## Storage and Audit

`account_lifecycle` stores cutoff/suspension/review state. `temporary_assignments`
stores time-bounded operational grants, author, scope, and revocation. Changes are
audited without credentials. Unrelated lifecycle flags are preserved atomically
when concurrent administrators update different aspects of an account.

Expiry is enforced but does not yet generate a separate background expiry audit
event or notification. No scheduled reminders, automatic reassignment, or HR/Entra
integration is implemented. The management list is capped at two hundred rows;
pagination and notification jobs remain future work.

## Offboarding Checklist

1. Set app cutoff or suspend immediately, with a recorded reason.
2. Separately disable/revoke the Microsoft identity/session as appropriate in Entra.
3. Reassign pending reviews, contractor oversight, and account handoffs manually.
4. Review recovery identities, service credentials, and privileged assignments.
5. Retain timesheets, financial evidence, encrypted messages, and audit history.

App denial cannot erase data or decrypted messages already accessed or cached by
the user. It is not a device wipe and does not revoke third-party credentials.

## Verification and Configuration

Tests cover expiry boundaries, scope restrictions, protected administrators,
revocation precedence, and grantor loss of authority. Live PostgreSQL migration/
concurrency tests and authenticated multi-account UI checks remain required.
No new Vercel environment variables or secrets are required. Existing database
bootstrap currently requires schema privileges; versioned migrations and separate
runtime credentials remain planned database-management work.
