# AI-assisted Timesheets and Review

Personal samples use the authenticated session name (email fallback), never a
client-provided identity. Personal extraction likewise binds the display name to
that identity. Samples are synthetic demonstrations, not proof of work.
Account managers with account visibility can preview multiple synthetic names;
they still cannot create, submit, edit, or delete operational timesheets.

Separate tasks must remain separate entries even when person, date, and project
match. Project grouping is a display concern and does not combine evidence.

## Review Routing

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

Logic is developed on `AI`. UI is developed on `user_Interface`. Tests use
synthetic identities and mocked model/database calls. Live deployment validation
and financial automation are not implied.
