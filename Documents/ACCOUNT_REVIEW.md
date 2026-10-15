# Account Review Workspace

Approved contractor and internal-employee evidence is handed to an active account
manager by an authorized manager or admin. Internal employee evidence represents
internal work/cost review, not an automatic contractor payout.

## Controls and Rights

Admins grant `send_to_accounts`, `view_accounts`, `review_accounts`, and
`ai_accounts` separately. Managers cannot delegate financial rights. Managers see
their sent handoffs; account managers see assigned evidence; admins see all.
Account managers do not gain operational timesheet editing or self-approval.

The UI groups records by the **recorded approving reviewer**, not an inferred
reporting manager. Search, category, reviewer, state, and date/hour sorting narrow
the queue. Details open in a separate window. Human triage requires an explicit
save and note. States are pending, needs information, ready for finance, archived.
Ready for finance is not payment authorization. Version checks reject concurrent
updates, and changed source approvals cannot be marked ready.

## Advisory AI

Grant `ai_accounts` together with visibility to enable analysis. The server uses
the existing AI Gateway credential and optional `ACCOUNT_REVIEW_MODEL` (default
`openai/gpt-4.1-mini`). Do not expose credentials through `NEXT_PUBLIC_*` variables.
Emails are pseudonymized; work descriptions are still sent to the model and may
contain personal information. Review the organization's data policy before use.
AI recommendations are advisory, not persisted, and never mutate review states
or release funds. Source revisions are checked again after analysis.

## Limits and Verification

Queues currently load at most 100 records, with analysis and handoff capped at 50.
True team ownership, pagination, payment calculation/reconciliation, stored AI
reports, and bulk financial triage remain future work. Tests mock database/model
calls; live database and authenticated visual acceptance still require validation.

Logic lives on `business_accounts`; presentation lives on `user_Interface`.
The latter integrates the backend locally for testing. Run `pnpm typecheck`,
`pnpm test`, and `pnpm build`. No push or Development merge is implied.
