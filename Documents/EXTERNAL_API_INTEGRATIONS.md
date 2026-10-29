# External API integration foundation

## Boundary

Tanovo Time has no active integrations with external business applications yet. The server-only connector runtime in `lib/integrations/http.ts` is groundwork; it does not call any provider until an authenticated application feature invokes it. Microsoft Graph is the first allowlisted host because it can serve Outlook, Teams, and SharePoint scenarios. Other providers must be deliberately added to the origin registry and reviewed before use.

The current Entra sign-in is for Tanovo Time authentication. Do not reuse or expand its login session to imply consent to another API. A future connector must request narrowly scoped delegated/application permissions through its own documented consent flow, and provide a server-side access token to the connector runtime. Never store provider tokens in browser storage, application logs, audit metadata, or source control. Do not add a credential database until token ownership, encryption/KMS, refresh/revocation, retention, and per-company isolation are designed.

## Connector contract

- Choose a fixed provider key; never accept arbitrary destination URLs or redirects.
- Use relative API paths, query parameters separately, and bounded request timeouts.
- Do not automatically retry writes. Add idempotency only when the provider and business operation have a defined key/behavior.
- Re-check the caller's current Tanovo Time permission and company boundary in the application route before obtaining a token or making a provider call.
- Treat provider responses as untrusted input. Validate them with a bounded schema before using them or persisting data.
- Keep request/response bodies and authorization headers out of logs. `IntegrationApiError` contains only provider, operation, method, relative path, status, safe error code, and provider request ID.
- Record only the minimum integration telemetry needed for support. The API error report should distinguish Tanovo Time's HTTP response from an upstream provider's status/code and correlate them using non-secret request references.

## Initial use-case shortlist

Confirm concrete workflows and app owners before granting consent or adding connectors:

1. Microsoft Graph for a specific Outlook calendar, Teams notification, or SharePoint export workflow.
2. A bookkeeping/accounting provider only after the timesheet-to-finance data contract and approval boundary are agreed.
3. A project/work-management provider only after project ownership, mapping, and conflict rules are specified.

Avoid broad mailbox/files scopes, background access without a clear owner, and one-way synchronization that can silently overwrite records. Start with one read-only workflow, then test revocation, pagination, rate limits, malformed responses, duplicate delivery, and audit/error reporting before enabling writes.

## Company isolation and rollout

The current deployment is single-company and binds `DEVONCALL` to its own operational database. Keep integration connection metadata and secrets isolated per deployment/company for now. Do not treat a company code or external tenant ID from a browser as an authorization boundary. A shared SaaS control plane needs tenant-scoped connections, verified ownership, audited consent changes, and cross-tenant isolation tests before multiple companies share storage.

The first implementation has no token persistence, OAuth consent UI, scheduled sync, or active provider calls. Those are separate deliverables after the first workflow and required provider scopes are selected.
