# AI-assisted Timesheets and Review

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

Logic and UI are integrated on `Development`; release PRs target `main`. Tests use
synthetic identities and mocked model/database calls. Live deployment validation
and financial automation are not implied.
