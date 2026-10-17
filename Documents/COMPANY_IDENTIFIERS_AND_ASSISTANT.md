# Company identifiers and assistant

## Company identity

The database retains the immutable UUID (`account_id`) and the existing long `contractor_number`. Neither is a login credential. Every account also receives a permanent, shorter display reference such as `TN-000123`, assigned by the database sequence and scoped to the company membership. The short reference is for people to read and remember; authorization continues to use the Microsoft-authenticated email and server-side access records.

Each deployment is bound to one company record. The first company defaults to code `DEVONCALL` and name `DevOnCall`. Set optional `COMPANY_CODE` and `COMPANY_NAME` in local/Vercel environments before that environment creates its company record. The database rejects a different company code after binding, preventing an accidental environment-variable change from relabeling an existing company database.

Managers and admins may enter an optional company employee ID when adding or correcting a person's official identity. The ID is stored exactly after surrounding whitespace is trimmed, is unique within the company, and remains distinct from all app-generated identifiers. It is not generated, guessed, used to sign in, or accepted as authorization proof. Keep official names in title case and emails lowercase. Existing official identity names and legacy timesheet display names are normalized when the directory initializes; personal nicknames remain user-controlled.

## Organization email-domain guidance

`COMPANY_EMAIL_DOMAINS` is an optional comma-separated list, such as `devoncall.net,devoncall.org`. The Add contractor/employee form compares new addresses against this list and warns admins/managers when an address is outside the organization's expected domains. Personal Gmail receives an identity-verification warning but is never blocked; the API does not enforce a company-domain restriction. Leaving this setting empty disables domain warnings. Configure it in `.env.local` for local work and in the corresponding Vercel environment for each deployment. This is deployment-level configuration today; per-organization settings should move into licensed-company administration when multi-tenant onboarding is introduced.

This schema is ready for a single-company deployment and a clear mapping to multi-company licensing. It does **not** yet provide shared-database multi-tenant isolation: `licensed_company` is deliberately a singleton, and the existing product tables still use their established ownership model. Before placing multiple customers in one database, add a tenant key and database-enforced tenant scoping to every company-owned table, unique constraint, query, audit path, cache key, and background task, then test cross-tenant access denial. For now, use a separate database per licensed company.

See [Company registration and tenancy](COMPANY_REGISTRATION_AND_TENANCY.md) for the company onboarding lifecycle, isolation model, and release gates.

## AI assistant

The assistant reads only the entries and inbox metadata visible through the signed-in user's normal APIs. It sees message metadata for unread-message tasks, but never receives encrypted message plaintext unless the user chooses **Explain with AI** on a specific message. It uses the existing AI Gateway model configuration and supports the `ASSISTANT_MODEL` override; no provider key is added to client code.

Its current action vocabulary covers opening authorized workspaces, asking grounded timesheet questions, creating and editing owned entries, submitting, approving or rejecting entries within the caller's rights, deleting eligible records, marking visible unread messages as read, changing authorized employee/contractor rights, preparing a message, and asking for an explanation of explicitly shared message text. Each proposed mutation appears in the chat and requires an explicit confirmation. A confirmed message is encrypted in the browser and sent through the existing encrypted message API. Server APIs repeat role, permission, ownership, workflow and revision checks.

The assistant accepts bounded JSON, uses Zod schemas for model output, filters proposals through current permissions, signs short-lived proposals to the current account and session, rate-limits requests, and consumes action tokens once. All data access remains in parameterized Neon queries and existing business APIs. The UI renders model text as text; it never injects HTML, executes scripts, SQL, model-generated URLs, or arbitrary function names. AI output remains untrusted advice, and it cannot bypass existing reviewer confirmation or payout authorization.

## Verification

`pnpm verify` runs type checking, the unit suite, and a production build. `pnpm test:e2e:url http://localhost:3000/tanovo-time` checks the local sign-in surface. Authenticated action testing still requires a normal Microsoft sign-in and real user review; automated tests use isolated sessions and never bypass production authorization.
