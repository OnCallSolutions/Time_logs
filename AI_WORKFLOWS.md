# Tanovo Time AI Workflows

## Guardrails

Tanovo Time's AI is an assistant over the application's existing business workflows, not a second authorization system. The model may interpret a request and propose a typed operation; the server resolves the current actor, company, permissions, target ownership, workflow state, and record revision. UI actions and AI actions should ultimately call the same business operation. Do not automate DOM clicks or accept model-generated JavaScript, SQL, arbitrary URLs, or permission decisions.

High-impact actions (submissions, approvals/rejections, account-access changes, messages, and deletions) require a clear impact preview and a separate human confirmation. The existing assistant already uses a bounded Zod action vocabulary, signed short-lived proposals, replay claims, and permission checks at execution. Preserve those boundaries as the action vocabulary grows.

## Current Implementation

- The main workspace retains its assistant. Other `WindowSurface` workspaces show a bottom-right **Ask AI** button; their assistant panel is mounted only after a user opens it.
- A window passes a normalized workspace key. The server uses it to request a narrower evidence set (for example, submitted records for approvals and inbox metadata only for Messages). The key is a UI hint, never an authorization claim.
- Assistant conversation history is stored in Postgres under the deployment's `licensed_company.company_id`, the authenticated patron email, and workspace key. Only the latest 20 messages are supplied as conversational memory. The browser cannot choose another account or company key.
- Conversation and model responses use `no-store`. Permissions, entries, and action outcomes are not cached. Full prompt or response bodies are not written to operational run analytics.
- Sanitized `assistant_runs` rows track company, actor, workspace, model, prompt/response character counts, proposal count, duration, and success/failure. This is operational metadata, not an audit transcript.
- Workspace transitions can carry a short, untrusted conversation handoff. The destination assistant reloads its own authorized evidence and must not treat the handoff as a permission grant or record source.

The company-directory module explicitly binds one installation to one licensed company. Company-scoped assistant tables are appropriate for this deployment, but they do **not** complete shared-database multi-tenant isolation for timesheets, audit, settings, or other app tables. Do not onboard multiple companies into one shared database until that boundary is implemented and tested across all data access.

## Workflow Shape

```text
User in a workspace
  -> scoped, authenticated assistant request
  -> minimal live evidence + recent private conversation
  -> structured answer and typed proposal(s)
  -> user reviews preview
  -> signed, expiring confirmation token
  -> same permission-checked business operation used by the UI
  -> refresh canonical database state + record sanitized outcome
  -> optional workspace handoff with bounded untrusted summary
```

Short questions and small read operations can remain synchronous. Extraction batches, long reviews, analytics generation, and reconciliations should become durable jobs, not long-lived web requests. Proposed job states: `queued`, `running`, `awaiting_confirmation`, `succeeded`, `failed`, `cancelled`. Store company and actor IDs, a minimal canonical-record reference, task type, idempotency key, attempt count, lease/heartbeat, progress, sanitized result reference, and timestamps. Do not store copied sensitive source data when a record ID and revision will do.

The database is the source of truth for job state. A queue/workflow is a delivery and orchestration layer. Consumers must be idempotent because queue delivery can repeat. Use a durable workflow for multi-step tasks that must retry, survive restarts, or pause for human approval; keep irreversible business actions behind the existing application confirmation and authorization path.

For any job that requires user confirmation, resume it through an authenticated application endpoint: resolve the reviewer from the active session, re-check company/record scope and revision, atomically persist one decision, then resume orchestration server-side. Repeated identical decisions should be idempotent; conflicting decisions should fail. Do not expose a workflow resume token as the approval capability. Track a durable workflow/job ID, idempotency key, retry attempt, lease/heartbeat, cancellation, failure reason, and timestamps in the database. Vercel Queues are at-least-once and currently document no built-in dead-letter queue, so consumers need deduplication and a database-backed retry/reconciliation path. Cron should trigger a catch-up/sweeper rather than be the sole delivery guarantee.

Notifications that follow a business-state change should use a transactional outbox: commit the state change and an outbox event atomically, then relay it asynchronously. This avoids a saved approval or submission whose notification was lost between the database write and event publication. Deduplicate reminders by company, period, recipient, and reminder type.

## Memory, Cache, and Context

- Conversation memory is per company, account, and workspace. It is conversational context, never canonical evidence. Resolve timesheets, permissions, assignments, and status from live server-side sources on each request and again on action confirmation.
- Do not add vector retrieval until company isolation, record-level authorization filters, provenance, deletion, and retention behavior are defined. If added, apply tenant and permission filters before ranking.
- Do not cache user permissions, AI action proposals, messages, or generated answers across actors. Any future cache must have an explicit owner/company scope, bounded TTL, revision/invalidation strategy, and tests for permission changes.
- The current rolling 20-message store needs a user-visible clear-history control and a product retention policy before production. The operational run table intentionally omits raw prompts and model outputs.
- Conversation content is currently stored as plaintext in Postgres. Before production, decide and implement retention/deletion controls, including user-visible clear history and a documented retention period; operational telemetry remains content-free. Do not imply end-to-end encryption for assistant conversations.
- AI-to-AI handoff passes only a small summary; the destination window fetches its own records and checks current access. No assistant should inherit another window's tool authorization.

## Security and Quality Gates

Every tool must have a strict schema, bounded input/output, explicit owner/company scope, current permission check, state/revision check, and idempotency where it can mutate. Keep user messages, extracted notes, past chats, and handoff summaries labeled as untrusted data. Render model text as text, never HTML. Keep SQL parameterized; keep same-origin and request-size protections on mutation endpoints; rate-limit per company and account.

Before enabling autonomous or durable workers, add tests for cross-company and cross-account reads, revoked permissions, stale revisions, duplicate delivery, interrupted execution, replayed approvals, prompt injection in timesheet descriptions and messages, malformed tool output, XSS payloads, and concurrent turns. Track latency, error class, model/version, proposal/confirmation/outcome counts, and cost where the provider supports it; never put message text, secrets, or encryption material in telemetry.

## Phased Delivery

1. **Contextual workspace assistants (underway):** on-demand window launchers, minimum relevant live context, persisted scoped chat, secure handoff, and navigation.
2. **Unified tools:** move shared UI and assistant mutations behind common service functions; add current-state checks, idempotency, and a readable action-impact preview.
3. **Durable jobs:** choose a Vercel Workflow/Queue integration after deployment constraints and current platform guidance are verified; persist canonical job state in Postgres and make every worker retry-safe.
4. **AI operations:** admin-only sanitized run analytics, failure triage, model/cost budgets, safe retention controls, and eval/red-team suites.
5. **Multi-company readiness:** tenant-scope every business table and query, enforce database policy/RLS where appropriate, and pass cross-tenant isolation tests before shared-database licensing.

## Primary References

- [AI SDK tool calling and approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK agent loop control](https://ai-sdk.dev/docs/agents/loop-control)
- [AI SDK message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Vercel WorkflowAgent durability and human approval](https://vercel.com/kb/guide/what-is-workflowagent)
- [Vercel Queues concepts](https://vercel.com/docs/queues/concepts)
- [Vercel Cron error handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Microsoft transactional outbox pattern](https://learn.microsoft.com/en-us/power-platform/architecture/reference-architectures/transactional-outbox-pattern)
- [Vercel human-in-the-loop workflows](https://vercel.com/kb/guide/human-in-the-loop-with-chat-sdk-and-workflow-sdk)
- [PostgreSQL row-level security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OWASP LLM Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
