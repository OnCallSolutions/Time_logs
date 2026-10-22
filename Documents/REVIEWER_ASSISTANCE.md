# Reviewer Assistance and Business Accounts

## Operational Boundaries

Managers see their own records and authorized submitted records belonging to other
people. Other people's drafts, rejected records and completed approvals are not
part of the manager queue. A named reviewing manager is selected when contractors
or employees submit; existing unassigned submissions retain the shared review lane.

The administrator configures cross-manager viewing and approval separately under
**Manage employees/contractors**. This covers both another manager's assigned
contractors and that manager's personal submissions. No one can approve their own
timesheets. Business accounts is restricted to admins and authorized
`account_manager` actors, regardless of operational manager permission overrides.

## Request Reviewer Help

A manager selects submitted records and presses **Request reviewer help**, chooses
another manager and confirms a reason. One request supports up to 50 records. It
creates an encrypted high-priority inbox message and exact-revision access grants
together. Both participants must have enrolled secure messaging devices; missing
keys never trigger plaintext delivery. Normal device enrollment is automatic.

The recipient must have `accept_review_requests` and `review_entries`. The sender
needs `request_review_help`, `delegate_permissions` and `send_messages`, plus direct
review authority or ownership of their own manager submission. Requests cannot be
recursively delegated. They do not change either person's global permissions.

Access expires after 48 hours and is invalidated by changed evidence, a completed
decision, or revoked grantor/recipient rights. The requester cannot choose an owner
as reviewer. The recipient refreshes Reviews to see the scoped submissions; incoming
messages also trigger a refresh. Message content remains encrypted at rest.

## Business Accounts

Operational approval forwards an immutable evidence snapshot to the business
accounts queue in the same database statement. There is no separate financial
dashboard for ordinary managers. Authorized business accounts actors can select
individual, multiple or all loaded actionable handoffs, up to 100 per operation.

Business accounts may return records to an eligible manager or directly to their
submitters, with a reason. Returns to managers restore submitted review work;
returns to submitters restore rejected work for correction. Manager-owned records
require an explicitly authorized independent manager when returned to that lane.

With the separate `authorize_payouts` right, an authorized business accounts actor
can confirm accuracy, compliance and housekeeping checks and record payout
eligibility. This locks the source against ordinary edits/deletion. It does not
calculate amounts, move money or execute a payment. Monetary rules remain future
work. Stale or partially changed selections fail as a whole rather than silently
authorizing only some records. Financial actions record audit evidence atomically.

## Storage and Verification

Additive lazy schema initialization creates `entry_review_requests`, a message
priority column, source assignment/eligibility fields and expanded handoff states.
It does not reset existing data. Review request grants/message creation are atomic;
their audit event is recorded afterward, so an audit failure requires refreshing
before retrying. Financial approval/return audit events share their SQL operation.

Run `pnpm verify` for types, unit/component tests and production build. Request API,
scope resolver and dialog tests exercise revocation, self-review prevention,
revision changes and encryption failures using mocks. These tests do not certify
live PostgreSQL locking behavior or authenticated multi-user delivery; verify those
with separate authorized accounts against a disposable database before production.
