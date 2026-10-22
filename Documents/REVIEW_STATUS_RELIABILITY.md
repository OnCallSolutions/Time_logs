# Review Status and Save Reliability

## Decision Boundaries

Approval atomically changes submitted evidence, forwards it to business accounts
and writes an audit event. Rejection now atomically changes submitted evidence
and writes its audit event too. Both use exact revisions, independent reviewer
identity, the submitted state and payout-lock checks. A human rejection reason is
required and is not copied into audit metadata. Self-review remains forbidden.

View-only cross-manager rights no longer permit recall or other status changes.
Contractor/employee submissions require a manager with live review and team-view
rights. The picker excludes managers who could not act on the submission.

Review permission is distinct from forwarding permission. Rejection can be available
while approval requires `send_to_accounts` (or the authorized account-manager lane).
The entries API exposes separate approval eligibility; row and selected-review
controls avoid offering approval when that forwarding right is absent.

## Interface Behavior

Single decisions and selected batches await server confirmation. Rejection reasons
remain intact on failure. Bulk review captures the opening evidence snapshot;
refreshing a row does not silently substitute a new revision into a confirmation.
Changed selections require closing/reopening the review. Completed records are
removed from retry selections, so partial failures do not appear fully successful.
Selected records can be returned for correction with an explicit shared reason.

Success states distinguish approval/forwarding, submission, recall and return to
submitter. Requests have timeouts; a timeout is an unknown outcome, not proof that
the server rejected the change. Refresh before retrying to avoid duplicate decisions.
Visible workspaces refresh entries every 15 seconds and when focused. Refreshes
do not renew sessions, preserve active local drafts, and cannot overwrite a newly
confirmed edit/decision with an earlier read response. This propagates manager
decisions to already-open submitter views without requiring a manual reload.
Database failures return a safe correlation reference rather than a generic client
validation error. Logs contain that reference and a sanitized SQLSTATE, not SQL,
names, work descriptions, credentials or rejection text.

## Admin Navigation

Admins enter the business-account queue via **Operations > Business accounts**.
It is no longer a standalone admin tab. It opens in its own window and Back returns
to Operations. Manage employees/contractors remains the separate permission editor.
Business-account managers retain their direct operational dashboard and admin
rights are not removed by the navigation grouping.

## Verification Limits

Regression tests cover stale evidence, view-only denial, rejection reasons,
correlation errors, selected snapshots and navigation. Read-only PostgreSQL metadata
inspection identified a pending additive `contractor_number` column in the local
configured database. EXPLAIN checks of the synthetic statements succeeded with that
pending return column modeled; no DML/DDL or real approvals were executed by those
checks. Normal schema initialization must apply the additive field on the next
authenticated timesheet request; restart the server after schema-changing code.

The user's exact failed authenticated button request has not been replayed against
their account. If it still fails, capture the displayed reference and relevant
sanitized server log, not credentials or private timesheet contents. Live write,
concurrency and handoff acceptance remain separate staging checks.
