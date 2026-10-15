# Role Workspaces

All roles use the integrated application, not separate branches. APIs enforce
ownership and live permissions; hiding a button is not authorization.

| Role | Responsibilities |
| --- | --- |
| Contractor | Outsourced work, own-name samples, drafts, submissions, corrections, project grouping |
| Employee | Internal personal time and explicitly delegated operational controls |
| Manager | Operational review, AI suggestions, confirmed decisions, delegation, messages, own-time lane |
| Account Manager | Assigned evidence triage, advisory AI, separately granted manager-timesheet review |
| Admin | Roles/rights, lifecycle, audit details, stored security reports |

## Dynamic Rights

Admins use Edit and Save to persist role/access/control overrides. Employee rights
lists every actor; managers edit only eligible active employee/contractor operational
rights they hold. They cannot promote roles, unblock accounts, or delegate financial,
technical-admin, AI, messaging, or delegation authority through this editor.

Same-browser events/BroadcastChannel refresh controls; other sessions poll every
15 seconds and on focus. APIs enforce changes immediately. Serializable access
updates preserve at least one active admin; environment recovery admins are protected.

## Review and Accounts

Manager timesheets require an account manager with `review_manager_entries`.
Another manager or admin cannot approve them. Self-review remains prohibited.
Account managers cannot create/edit/delete/submit timesheets or acquire ordinary
operational review through generic overrides.

Operational AI belongs to the authorized manager/admin lane. An employee flag
alone does not grant that endpoint. Manager-timesheet AI requires
`review_manager_entries` and `ai_accounts`. Advice is revision-bound and
requires explicit human decisions.

Approved contractor/employee evidence is explicitly handed to active account
managers. Triage does not release funds. See [account review](ACCOUNT_REVIEW.md).

## Messages and Acceptance

The top-right chat icon shows unread counts. Encryption connects automatically
after Microsoft sign-in; there is no normal recovery/unlock form. Each recipient
must sign in once to enroll. Only authorized participants can read conversations.
See [messaging security](MESSAGING_SECURITY.md).

Run `pnpm verify` and `pnpm test:e2e` from the repository root. Use distinct
accounts and browser profiles for all five roles at `/tanovo-time`.

- Contractor/employee: own samples, separate work units, submit/recall/correct, ownership isolation.
- Manager: explicit approve/reject, required reasons, cancel without mutation, no self-review.
- Account manager: assigned scope, note/version checks, separate manager-review permission.
- Admin: unsaved edits, explicit Save, last-admin protection, full audit details.
- Cross-role: change rights while another session is open; verify refresh and API denial.
- Messaging: automatic connection, enrollment failure, audience isolation, receipts, edit/delete.

Mocks do not replace live Microsoft, database, AI, or multi-device acceptance.
See [testing](TESTING.md) and [URLs](URL_CONFIGURATION.md).
