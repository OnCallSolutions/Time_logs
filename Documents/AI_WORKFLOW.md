# AI-assisted Timesheets and Review

## Assistant Commands

The workspace assistant accepts natural-language requests and maps them to a
closed set of app commands: open a role-authorized page; create, edit, delete,
submit, approve, or reject timesheet entries; prepare a message draft; manage
message read state; or update delegable account rights. Each proposed command
opens a review popup in chat. The user must confirm there before the server
revalidates permissions, record revisions, and executes the same business
handler used by the regular application.

The assistant does not automate DOM clicks, accept arbitrary scripts, or use
coordinates. A request that has no matching app command is explained rather than
simulated. Page navigation is an allowlisted action filtered by current role and
permissions; it cannot grant access to a page or record.

Personal samples use the authenticated session name (email fallback), never a
client-provided identity. Personal extraction likewise binds the display name to
that identity. Samples are synthetic demonstrations, not proof of work.
Account managers with account visibility can preview multiple synthetic names;
they still cannot create, submit, edit, or delete operational timesheets.

Separate tasks must remain separate entries even when person, date, and project
match. Project grouping is a display concern and does not combine evidence.
The sample selector offers 3, 6, or 12 tasks per person across days/projects.
Extraction explicitly preserves individual same-day/project tasks. Manual pencil
editing uses a local draft with explicit Save/Cancel and revision-bound persistence.

## Review Routing

### Personal Submission Preparation

Actors with `submit_entries` may prepare their own draft/rejected evidence through
`POST /tanovo-time/api/entries/prepare-submission`. This is personal assistance,
not the privileged `ai_review` endpoint for deciding other people's work.
Account managers cannot submit or prepare personal submissions.

The UI accepts individual, multiple, or all eligible loaded entries. AI requests
are split into at most 50 evidence snapshots per call; each requires exact server
ownership and revisions. Advice covers every selected entry, with rights and
source evidence checked again after analysis. No status changes happen during AI.

Humans explicitly confirm submission after inspecting the advice, or submit
manually without AI. Confirmed PATCH operations are per entry, not one atomic batch.
Read-only analysis can be canceled; cancellation never submits evidence. Confirmed
writes block dismissal until the current operation resolves.
Failures stop progress; confirmed rows remain submitted and are excluded from retry.
The UI retains remaining rows and reports partial progress rather than claiming
everything succeeded. Timed-out writes can have an unknown outcome: refresh before retry.

Submission enters the existing manager review queue; managers' own time enters
the account-manager review lane. It does not assign a named reviewer, create team
membership, send a message, or imply manager notifications. Named manager/team
assignment remains future work. AI uses the existing Gateway configuration.
Selected work descriptions and correction notes are sent to the configured AI
service; email identities are omitted from this preparation prompt. Apply the
organization's data-sharing policy to free-form evidence before requesting AI.

### Independent Decisions

Manager-owned timesheets can be approved or rejected only by an account manager
with the admin-granted `review_manager_entries` right. Other managers and admins
cannot make those decisions. Self-review stays prohibited. Account managers do
not acquire contractor/employee operational approval rights through this control.

Managers hand approved contractor/employee evidence to active account managers
through Business accounts. Handoff is explicit, not automatic on approval. Managers
have this control by default; an administrator can deny it. Recipients cannot be
other operational reviewers. Account-manager review does not release funds.

## AI Advice and Concurrency

Operational AI uses `ai_review`; manager-timesheet AI requires both
`review_manager_entries` and `ai_accounts`. Evidence is loaded on the server,
checked for authorized review lane, then checked again after analysis. Responses
carry evidence revisions; review commands can bind decisions to those revisions.
Database revision conditions reject stale decisions without applying them.
AI never auto-approves work, and uncertain evidence requires human investigation.

Model calls have a 22-second analysis deadline and no automatic retry loop.
Configuration, throttling, timeout, and generic failure responses use safe codes
and never include raw provider bodies or credentials. Access is rechecked after
analysis. Owner-role lookups are reused only within the current request, not
across requests or accounts.

## Model Routing

Each server-side workflow has its own environment override, resolved by
`lib/ai-models.ts`: `ASSISTANT_MODEL`, `TIMESHEET_EXTRACTION_MODEL`,
`SUBMISSION_PREPARATION_MODEL`, `TIMESHEET_REVIEW_MODEL`, `ACCOUNT_REVIEW_MODEL`,
and `SECURITY_REVIEW_MODEL`. They default independently to
`openai/gpt-5.4-mini`, a model currently listed by AI Gateway with structured
output support and catalog metadata `no_training: all` / `zdr: all`. The live
catalog is authoritative; verify availability and provider policy before changing
overrides. Values must be `provider/model` identifiers, never URLs or client input.

The main and contextual window assistant share the assistant workflow model;
page-specific extraction, submission, manager review, account review, and security
monitoring calls use their own setting. Configure overrides as server-side
environment variables per Vercel environment or in local `.env.local`. The
AI Gateway credential remains `AI_GATEWAY_API_KEY` locally/externally; linked
Vercel deployments may use the platform OIDC credential. Model selection does not
change caller permissions or confirmation requirements. Run `pnpm test` after
model-routing changes; mocked tests prove routing only, not live provider access.

Logic and UI are integrated on `Development`; release PRs target `main`. Tests use
synthetic identities and mocked model/database calls. Live deployment validation
and financial automation are not implied.
