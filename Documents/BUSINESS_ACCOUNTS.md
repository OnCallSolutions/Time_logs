# Business Account Wing

Current operational behavior is documented in [REVIEWER_ASSISTANCE.md](REVIEWER_ASSISTANCE.md):
approval automatically forwards evidence; authorized business accounts can return
records and record eligibility after checks. Eligibility is not payment execution.
The scaffold/future-design notes below predate that implementation.

The integrated application implements assigned contractor/employee evidence handoff
and financial triage, not payment calculation or fund release. See [ACCOUNT_REVIEW.md](ACCOUNT_REVIEW.md)
for implemented eligibility, snapshot, rights, and stale-source rules. The sections
below distinguish implemented rights from remaining financial workflow design.

Account Manager (`account_manager`) is a distinct manager-level category, assigned
through the existing administrator-only role editor. Internal employees and
outsourced contractors remain separate roles. Ordinary managers cannot assign
this category or delegate account-manager rights.

Account managers do not enter, edit, delete, or submit timesheets. They do not
perform the operational approval stage. Existing operational permission overrides
cannot enable those actions for this role. Team/report access remains explicitly
controlled by the administrator; the role does not grant blanket visibility.

An account manager may approve/reject manager-owned timesheets only with the
separate `review_manager_entries` right. Manager-timesheet AI additionally needs
`ai_accounts`. Self-review is prohibited. This does not grant ordinary operational
review of contractor/employee submissions. Role assignment alone grants none of
these financial/review rights.

Assigned handoffs support search, category/reviewer/state filters, date/hour
sorting, evidence windows, advisory AI, and explicit note-backed triage. Grouping
uses the recorded approving reviewer, not a true team-assignment relationship.
Ready for finance is not authorization to release funds.

## Future Workflow

Operational managers first approve contractor work. Account managers then collect
approved contractor items across their authorized teams, review payment amounts,
and authorize release of funds. Operational approval and financial authorization
must be separate statuses, with separate permissions and audit events.

Future design must establish rates, currency, taxes, payment periods, approved-item
eligibility, duplicate-payment prevention, account-manager scope, and who executes
payments after release. Changes after operational approval must invalidate financial
approval or require explicit reconciliation. Financial controls must be enforced
server-side, not just hidden in the UI.

No payment calculation, financial approval, or transfer functionality is implemented
by this role scaffold. It must not be treated as a live funds-release system.
