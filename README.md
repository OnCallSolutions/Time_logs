# Tanovo Time

AI-assisted contractor time logging, manager review, and internal staff administration built with Next.js, Microsoft Entra ID, and Neon PostgreSQL.

**AI prepares the work; people review and confirm decisions.** The application is served at `/tanovo-time`.

See [Session Security](Documents/SESSION_SECURITY.md) for the approved 30-minute
idle/8-hour maximum policy and [Review Reliability](Documents/REVIEW_STATUS_RELIABILITY.md)
for confirmed status changes and the admin Operations grouping.

Current identity/messaging work is described in
[Official Identities](Documents/OFFICIAL_IDENTITIES.md) and
[Message History and Recovery](Documents/MESSAGE_HISTORY_RECOVERY.md), including
opt-in server-only recovery variables and legacy-history limitations.

For current manager visibility rules, encrypted high-priority reviewer-help requests,
automatic business-account forwarding, returns and payout eligibility, see
[Reviewer Assistance](Documents/REVIEWER_ASSISTANCE.md). This describes the current
workflow where it supersedes older financial scaffold notes below.

Account cutoff schedules, suspension, and temporary operational assignments are
integrated into `Development`.
See [ACCESS_LIFECYCLE.md](Documents/ACCESS_LIFECYCLE.md) for scope, precedence, administrator
protection, and the separate Microsoft offboarding checklist.

For the contractor-centered operational review and business-account handoff changes
integrated into Development, including reviewer separation and Vercel role-list names, see
[CONTRACTOR_WORKFLOW.md](Documents/CONTRACTOR_WORKFLOW.md). These changes are currently on
Development through the manager/business-account integration. Verify live deployment separately.

Contractors are outsourced workers who log their own time and submit it for review.
Employees are internal company staff. Managers review work and delegate permitted
controls; administrators manage technology and access. The former baseline `user`
role is now `contractor`; generic account identifiers and audit target names remain
unchanged. Existing stored `user` assignments are read as contractors without
rewriting their permissions or deleting historical records.

Account Manager is a separate, administrator-assigned business-account role. It
cannot enter timesheets or approve contractor/employee operational work, but can
review manager timesheets when granted `review_manager_entries`. Payment calculation
and authorization to release funds are planned, not implemented; see
[BUSINESS_ACCOUNTS.md](Documents/BUSINESS_ACCOUNTS.md).

For GitHub, Vercel, and Microsoft Entra names/URLs, see [REBRANDING.md](Documents/REBRANDING.md). Both retained branches contain the integrated `/tanovo-time` application; older deployed snapshots may still serve older code.

For the exact Development URL, Azure callbacks, local ports, and branch-specific rules, see [URL_CONFIGURATION.md](Documents/URL_CONFIGURATION.md).

## Contents

- [Branches and release status](#branches-and-release-status)
- [Role workspaces](#role-workspaces)
- [Local setup](#local-setup)
- [Configuration and Microsoft sign-in](#configuration-and-microsoft-sign-in)
- [Testing](#testing)
- [Storage and architecture](#storage-and-architecture)
- [Deployment and releases](#deployment-and-releases)
- [Security and troubleshooting](#security-and-troubleshooting)

## Branches and Release Status

| Branch | Purpose | Pull request destination |
| --- | --- | --- |
| `Development` | Shared source of truth for integrated features and testing | `main` for releases |
| `main` | Reviewed release code | Receives release PRs from `Development` |

Only `main` and `Development` are retained after integration. Retired feature
branches remain represented in Development's commit history. Runtime roles and
permissions are independent of Git branches.

This README describes the current Development checkout. Main contains the prior
integrated release, not necessarily the latest local changes described here.
Release through reviewed Development-to-main pull requests. A successful build
or merge does not verify a production deployment.

## Feature Status

Integrated features include Microsoft sign-in, personal profiles, role/control
management, lifecycle schedules, operational and manager-timesheet review,
account handoffs/triage, advisory AI, automatic encrypted messaging, audit details,
security reports, and the external live test console.

True multi-team isolation, persisted AI review jobs, complete cursor pagination,
rates/taxes, payment authorization/execution, and financial reconciliation remain
future work. Financial triage is not fund release. See the guides in `Documents/`.

## Role Workspaces

The following describes the integrated `Development` experience. Existing capabilities remain available unless a saved permission override explicitly restricts a control.

| Role | Main responsibilities |
| --- | --- |
| Contractor | Outsourced worker: log own time, submit work, correct rejected entries, and read authorized messages |
| Employee | Extract notes into drafts, review/edit eligible entries, submit or recall work, correct rejected entries, maintain a profile, and read authorized messages |
| Manager | Review team entries, ask AI to prepare recommendations, confirm approvals/rejections, use reports, delegate permitted workflow rights, and send individual or broadcast employee messages |
| Account Manager | Review assigned financial evidence and, with a separate admin-granted right, manager timesheets; no creation of operational timesheets or fund release |
| Admin / technology manager | Manage identities, roles, and control permissions through Edit/Save; inspect audit details and stored AI security reports; retain existing entry and reporting capabilities |

Managers may delegate only workflow rights they hold. They cannot promote account roles, unblock employees, or delegate technical-admin access. Team visibility and approval are separate rights.

Permission changes are stored in the database. Same-browser tabs receive refresh notifications; other sessions refresh every 15 seconds and on focus. APIs check current rights on each request. Private messages are scoped to sender and recipient; employee broadcasts are scoped to eligible accounts.

AI recommendations are advisory. They cannot verify that work happened and do not automatically approve time, block accounts, or grant permissions.

Entries start read-only. Use the pencil beside a work unit, then Save or Cancel;
typing does not send updates. Cancel discards the local draft, and failed saves
retain it with an error. Repeated person/day/project labels are clustered without
merging tasks. Sample notes support 3, 6, or 12 work units per authenticated person.

The landing summary shows status counts/hours, project activity, and authorized
review workload. Related commands are grouped under Timesheets, Review & accounts,
Insights, and Access & security, with full-screen child windows and Back navigation.

Select one, several, or all eligible loaded entries for manual submission or AI
preparation. AI only advises; humans confirm submission. Confirmed rows remain
submitted if a later row fails, and retries exclude those successes. Submissions
enter existing review queues, not a newly assigned individual manager. See
[AI workflow](Documents/AI_WORKFLOW.md) for rights, batching, and revision checks.

## Local Setup

### Prerequisites

- Node.js 20.9 or later; Node.js 22 matches the test workflow.
- pnpm; the test workflow currently uses pnpm 12.4.2.
- A Neon PostgreSQL database, a Microsoft Entra application registration, and AI Gateway credentials for live AI operations.

```powershell
git clone https://github.com/OnCallSolutions/Time_logs.git tanovo-time
cd tanovo-time
git switch Development
pnpm install --frozen-lockfile
```

Create an untracked `.env.local` with the values described below, then start the development server:

```powershell
pnpm dev
```

Open [http://localhost:3000/tanovo-time](http://localhost:3000/tanovo-time).

For a production-style local run:

```powershell
pnpm build
pnpm start --port 3002
```

Open `http://localhost:3002/tanovo-time`. For Microsoft login on this port, set
local `AUTH_URL=http://localhost:3002` and register its matching Azure callback.
Stop the server before changing branches and rebuild before using `pnpm start`.
A build from another branch can show stale features or routes. Use separate
worktrees and browser profiles for concurrent branch testing.

## Configuration and Microsoft Sign-In

Keep secrets in `.env.local` locally and server-side environment settings on Vercel. Never commit real credentials or prefix secrets with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `AUTH_SECRET` | Secret used by the authentication/session system |
| `AUTH_URL` | Canonical origin, such as `http://localhost:3000` or a stable deployment domain |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Microsoft application client ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Microsoft client secret value, not its secret ID |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Tenant issuer URL, normally `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `AI_GATEWAY_API_KEY` | AI Gateway credential for local or externally authenticated AI requests |
| `ALLOWED_EMAILS` | Optional comma-separated baseline access list |
| `CONTRACTOR_EMAILS` | Optional outsourced-contractor access list; baseline `ALLOWED_EMAILS` also resolves to contractors |
| `ADMIN_EMAILS` | Admin bootstrap/recovery identities |
| `MANAGER_EMAILS` | Optional environment-backed manager identities |
| `EMPLOYEE_EMAILS` | Employee identities in `Development` |
| `WORKER_EMAILS` | Legacy employee-list compatibility |
| `ACCOUNT_MANAGER_EMAILS` | Optional account-manager role list; control rights require separate admin grants |
| `ACCOUNT_REVIEW_MODEL` | Optional account-review model override |
| `CRON_SECRET` | Server-only authentication token for scheduled security monitoring in `Development` |

Configure explicit access lists for restricted environments. Without environment access lists, the current policy may allow authenticated Microsoft accounts by default. In `Development`, managed active/denied/blocked assignments participate in access resolution; environment recovery admins remain a recovery path.

### Microsoft Redirect URIs

Register these as **Web** redirect URIs in the same Entra application used by the deployment:

```text
http://localhost:3000/tanovo-time/api/auth/callback/microsoft-entra-id
https://<stable-deployment-domain>/tanovo-time/api/auth/callback/microsoft-entra-id
http://localhost:3002/tanovo-time/api/auth/callback/microsoft-entra-id
https://tanovo-time-git-development-devoncall.vercel.app/tanovo-time/api/auth/callback/microsoft-entra-id
```

The URI must match the actual scheme, host, port, and path. Use stable branch aliases for previews rather than deployment-specific URLs that change after redeploys. Scope preview `AUTH_URL` values to the corresponding branch so one branch does not redirect into another.

Application permission grants do not create Microsoft accounts, tenant guests, or Entra application assignments. Those identity-provider requirements are configured separately.

## Testing

The automated framework is integrated into Development and main. Run commands from the repository root, not `Documents/`. On a fresh checkout, run `pnpm exec next typegen` before typechecking if generated route types are missing.

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Explicit TypeScript validation |
| `pnpm test` | Unit, component, and mocked API tests |
| `pnpm test:coverage` | Coverage report |
| `pnpm verify` | TypeScript, tests, and production build |
| `pnpm test:install` | Install Playwright Chromium |
| `pnpm test:e2e` | Local browser sign-in smoke test |
| `pnpm test:e2e:url <url>` | Browser smoke test against a deployed `/tanovo-time` URL |
| `pnpm test:ui` | Standalone local test console, outside the application |

The test console runs at `http://127.0.0.1:4317`; it is not an authentication target.
Local Playwright runs use isolated port 3100 and `.next-e2e`, refusing to reuse
another running server. The live table/detail console is integrated into Development;
the old testing branch is retired. Automated tests mock database/model
responses and do not establish that live Microsoft, Neon, or AI configuration works.
Test those integrations with distinct authorized contractor, employee, manager,
account-manager, and admin accounts.

Run TypeScript explicitly: the current Next.js configuration skips type failures during production builds, so a successful build alone is insufficient validation.

See [testing](Documents/TESTING.md), [role workspaces](Documents/ROLE_WORKSPACES.md), and [branch ownership](Documents/BRANCH_OWNERSHIP.md) for test cases and release guidance. The dated [verification record](Documents/TEST_RESULTS.md) separates completed automated checks from unverified live acceptance.

## Storage and Architecture

| Location | Responsibility |
| --- | --- |
| `app/` | Pages, layouts, authentication actions, and API routes |
| `components/` | Shared UI and role-specific workspaces |
| `lib/db.ts` | Neon accessors and idempotent schema initialization |
| `lib/access.ts` | Identity allowlist and role resolution |
| `lib/permissions.ts` / `lib/effective-permissions.ts` | Control definitions and server-side rights resolution in `Development` |
| `auth.ts` | Microsoft Entra ID / Auth.js configuration |
| `next.config.mjs` / `lib/paths.ts` | `/tanovo-time` routing configuration |
| `e2e/`, `tests/`, `tools/` | Automated tests and external test tools in `Development` |

The integrated application stores entries, profiles, managed access with JSONB overrides, lifecycle/temporary assignments, account handoffs, audit events, security reports, and encrypted messages/devices/receipts in twelve public tables. Schema helpers create required tables/columns idempotently; the database credential must permit those operations. Use separate development/test and production databases.

Integrated database management adds retry-safe, process-cached schema initialization
and avoids replacing current access-role constraints on every cold start. It does
not yet provide versioned migrations, cursor pagination, or AI job storage. See
[DATABASE_MANAGEMENT.md](Documents/DATABASE_MANAGEMENT.md). On 2026-10-15, the database
selected through this repo's `.env.local` was reset with authorization: all twelve
tables were verified empty in the transaction, with schemas preserved. Later use
can create data again. Reconfigure database-managed rights; environment lists remain.
This did not erase Vercel logs, Entra records, or provider backups.

## Deployment and Releases

1. Keep integrated work on `Development`; only `Development` and `main` are retained.
2. Preserve all feature commits in Development before deleting their branch references.
3. Validate the integrated application with automated checks and live role/permission tests.
4. Record verification results and open a reviewed PR from `Development` into `main`.
5. Configure production secrets, Microsoft redirect URIs, and database access before deploying the release.

Vercel environment changes require a new deployment to take effect. Employee rights stored in the database do not require environment-variable changes or a redeploy.

The integrated `vercel.json` disables automatic Git deployments except for `main`.
Deploy Development manually through Vercel's Create Deployment using the branch
`Development`; redeploying an older deployment rebuilds its older commit. Rules
apply to branches containing that configuration, not automatically to unchanged
branches. Keep Production unchanged until a reviewed release. Development's
Preview `AUTH_URL` override is `https://tanovo-time-git-development-devoncall.vercel.app`.

The development security monitor is configured for daily execution at 06:00 UTC. Vercel cron executes on production deployments, not previews. Preview/local monitoring must be invoked separately with the configured bearer secret. Reports inspect at most 250 recorded events from the previous 24 hours and expose coverage limitations; this is not comprehensive malware or infrastructure monitoring.

The manager AI review endpoint processes up to 50 submitted records per request. Humans must confirm each resulting workflow decision.

## Security and Troubleshooting

Development messaging includes one-hour sender editing, confirmed deletion,
delivery/read receipts, unread badges, optional popups/sound, chat bubbles,
search, and conversation filtering. Messages opens from the top-right header;
device keys connect automatically after Microsoft sign-in with no recovery or
unlock form. Private keys stay in browser IndexedDB. See
[MESSAGING_DEVICES.md](Documents/MESSAGING_DEVICES.md) for device and history limits.

New sends require each recipient to sign in once for automatic device enrollment. Historical plaintext
may still exist; the quiet chat view does not label every bubble's encryption state.
See [MESSAGING_SECURITY.md](Documents/MESSAGING_SECURITY.md) for protocol and device/history
limits. This custom development protocol is not WhatsApp's protocol and requires
independent security review before production use. No message plaintext or recovery
secret should be passed to AI.

- Keep secrets server-side and `.env.local` untracked. Rotate any credential that has been exposed; hiding a file later does not remove it from Git history.
- Technical audit/security tools remain admin-only. IP addresses and full audit JSON appear in selected-event details rather than compact activity rows.
- Local IP values such as `::1` or `127.0.0.1` represent loopback, not a missing address.
- `EADDRINUSE` means another process owns the server port. Stop that server before starting another, or use a different port and update matching auth/redirect configuration.
- A missing production build requires `pnpm build` before `pnpm start`.
- For 404s or stale pages after switching branches, stop the server and rebuild; use `/tanovo-time` consistently.
- For authentication configuration errors, verify environment scope, client-secret value, issuer, and exact redirect URI. A personal Microsoft account may need tenant invitation or a compatible app registration.
- For unavailable AI analysis, verify AI Gateway authentication. Manual review remains available.

Contributions should include suitable regression tests and maintain multi-line Doxygen-style file/function documentation with parameters and return types. Follow [agent guidance](Documents/AGENTS.md) and installed Next.js guides when changing framework behavior.

See [Company identifiers and assistant](Documents/COMPANY_IDENTIFIERS_AND_ASSISTANT.md) for the account reference scheme, external company employee IDs, tenant deployment boundary, assistant permissions, and security model.
