# Contractor-Centered Workflow

Tanovo Time primarily supports outsourced contractors and their operational
managers. Internal employees remain a distinct category with their existing
personal time controls. No application, repository, or URL rename is required.

## Roles and Screen Names

| Stored role | Visible name | Responsibility |
| --- | --- | --- |
| `contractor` | Contractor | Outsourced time submissions, corrections, project and reviewed-hour summaries |
| `employee` | Employee | Internal company time and authorized workflow controls |
| `manager` | Manager | Operational review, AI-assisted evidence inspection, and own managerial timesheets |
| `account_manager` | Account Manager | Assigned approved-contractor evidence for future payment review |
| `admin` | Administrator / technology manager | Account roles, control rights, security, and recovery access |

Legacy stored `user` assignments still map to `contractor`. Generic technical
account identifiers, Microsoft session `user` objects, and audit target names are
not renamed. Contractor reviewed hours are not a calculated payment amount.

## Approval Rules

1. Contractors and employees create drafts, submit them, and correct rejected work.
2. Managers may submit their own managerial time, but another authorized reviewer
   must approve or reject it. Administrators cannot self-review either.
3. Reviewer separation is checked against the server-owned email, not the editable
   contractor display name. SQL independently blocks self-review and requires the
   entry still to be submitted before accepting a decision.
4. Single, multiple, or all-eligible selections are bounded to fifty per action.
   All means eligible records in the loaded review queue, not hidden or unlimited
   database rows. Batches confirm each server response; a failed record stops the
   remaining batch and already-confirmed rows remain applied.
5. Managers/admins need `ai_review` for suggestions and `review_entries` for actual
   decisions. AI suggestions are shown in a dialog and never mutate records.
   An approval suggestion can be explicitly confirmed; rejection still requires
   the established human review dialog and reason.

## Business-Account Handoff

Managers/admins with the admin-granted `send_to_accounts` right select approved
contractor records and an active Account Manager, then explicitly confirm handoff.
Internal employee records are not eligible for this financial queue.

`account_handoffs` stores the entry reference, assigned account manager, handing-off
identity, source update timestamp, and approved evidence snapshot. Each entry revision
can be handed off once. Duplicate or changed approvals can yield fewer new rows than
requested; the response states both counts. Source changes flag the queue item stale.
The entry foreign key protects handed-off records from physical deletion; an archival
workflow must be designed before deleting financial evidence. The candidate queue
examines the first hundred approved visible records and shows only current contractors;
the assigned queue is limited to one hundred handoffs. Cursor pagination remains future
work, so neither list should be treated as a complete historical financial report.

Account managers need the admin-granted `view_accounts` right to read their assigned
queue. Admins with that right can inspect all queues. Managers cannot delegate either
financial right through employee delegation. Handoff is not financial approval and
does not transfer money. Rates, taxes, currencies, payment batches, release authority,
reconciliation, and execution remain to be designed.

## Vercel Variables

Optional comma-separated role lists, containing email addresses only:

```text
ADMIN_EMAILS
MANAGER_EMAILS
ACCOUNT_MANAGER_EMAILS
EMPLOYEE_EMAILS
CONTRACTOR_EMAILS
```

`ALLOWED_EMAILS` remains a baseline contractor allowlist. Prefer database-managed
assignments from the admin editor for routine onboarding; active assignments do
not require a redeploy. Environment administrators remain protected recovery
identities. `ACCOUNT_MANAGER_EMAILS` assigns the category but does not automatically
grant `view_accounts`; set its control rights through the admin editor.

Keep the existing server-only `DATABASE_URL`, `AUTH_SECRET`, Microsoft provider
credentials, and AI Gateway credentials. Financial rights are database permissions,
not new Vercel secrets. Never create `NEXT_PUBLIC_` variants of credentials.

Development Preview `AUTH_URL` remains:
`https://tanovo-time-git-development-devoncall.vercel.app`.
The Entra callback remains that origin plus
`/tanovo-time/api/auth/callback/microsoft-entra-id`.

Role lists alone do not create Azure tenant users or change Entra assignments.
Save Vercel environment changes and create a new deployment to apply them.

## Branches and Verification

`manager` contains operational review groundwork. `business_accounts` builds on it
for financial handoff. `user_Interface` retains separate white/orange visual changes;
`messages` retains recipient audiences. These latest feature changes have not been
merged into Development. Consult Git branch tracking for publication status.

Unit/API tests cover self-review denial, selection confirmation, handoff rights,
contractor eligibility, and account-manager queue scoping. Live Azure/Neon/AI tests,
SQL migration/concurrency tests, and authenticated multi-role visual checks are still
required before release. No live database maintenance or payment action was performed.
