# Business Account Wing

Account Manager (`account_manager`) is a distinct manager-level category, assigned
through the existing administrator-only role editor. Internal employees and
outsourced contractors remain separate roles. Ordinary managers cannot assign
this category or delegate account-manager rights.

Account managers do not enter, edit, delete, or submit timesheets. They do not
perform the operational approval stage. Existing operational permission overrides
cannot enable those actions for this role. Team/report access remains explicitly
controlled by the administrator; the role does not grant blanket visibility.

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
