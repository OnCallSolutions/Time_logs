# Database Management Roadmap

Database work is isolated on `database_management`. No live database maintenance,
data deletion, migration execution, or AI indexing has been performed.

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
