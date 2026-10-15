# Database Management Roadmap

Database improvements are integrated into `Development` and released through
`main`. The former database-management branch is retired.

## Authorized Fresh Start

On 2026-10-15, the database referenced by this repository's ignored `.env.local`
was reset with explicit authorization. All twelve public application tables were
truncated in one transaction, identities restarted, and zero rows verified before
commit. Schemas, constraints, and indexes were preserved; no CASCADE was used.

Tables: `time_entries`, `user_profiles`, `managed_user_access`,
`account_lifecycle`, `temporary_assignments`, `account_handoffs`,
`app_messages`, `app_message_keys`, `app_message_devices`,
`app_message_receipts`, `audit_events`, and `security_reports`.

Later app activity can create rows again. Environment allowlists and secrets
remain; database-managed role/permission overrides need configuring again.
Verify a valid `ADMIN_EMAILS` recovery identity before onboarding. This reset did
not erase Vercel runtime logs, Entra records, or provider backups, and did not deploy
production.

Never reset automatically on startup/deployment. Future resets require explicit
target confirmation, retention/backup review, and a separately approved operator
action. Do not paste connection strings into documentation or logs.

## Implemented Groundwork

Time-entry, profile, audit, and access-schema initialization share concurrent setup
attempts and retry after transient failures. Successful setup remains cached per
process. Access-role constraints are changed only when the current definition
lacks the required roles, rather than dropped and recreated on every cold start.

## Next Priorities

1. Move schema changes into versioned, checksum-verified migrations with a dedicated
   migration credential and transaction/advisory-lock coordination. Runtime credentials
   should eventually have no schema-alteration privileges.
2. Introduce cursor pagination and bounded projections for entries, actor rosters,
   audits, and AI input. Avoid silently truncating reports; return page cursors.
3. Profile real query plans before adding composite indexes. Preserve owner scoping,
   role permissions, and manager/team boundaries in every query.
4. Store AI jobs, input revisions, model/prompt versions, usage, results, and human
   review decisions separately from source records. Use idempotent job identifiers
   and reject results whose source revision has changed.
5. Add realistic PostgreSQL integration tests, migration upgrade tests, backup/restore
   drills, retention policy, and least-privilege database credentials.

Private message plaintext and recovery secrets must never enter AI input or database
logs. No vector database or embeddings are necessary until a retrieval use case and
its access filters are established. Financial release requires a separate ledger and
approval model; approved timesheets alone must not trigger payments.
