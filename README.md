# Tanovo Time

AI-assisted contractor time logging, manager review, and internal staff administration built with Next.js, Microsoft Entra ID, and Neon PostgreSQL.

**AI prepares the work; people review and confirm decisions.** The application is served at `/tanovo-time`.

Contractors are outsourced workers who log their own time and submit it for review.
Employees are internal company staff. Managers review work and delegate permitted
controls; administrators manage technology and access. The former baseline `user`
role is now `contractor`; generic account identifiers and audit target names remain
unchanged. Existing stored `user` assignments are read as contractors without
rewriting their permissions or deleting historical records.

Account Manager is a separate, administrator-assigned business-account role. It
cannot enter timesheets or perform operational time approvals. Payment calculation
and authorization to release funds are planned, not implemented; see
[BUSINESS_ACCOUNTS.md](BUSINESS_ACCOUNTS.md).

For GitHub, Vercel, and Microsoft Entra name/URL migration, see [REBRANDING.md](REBRANDING.md). This rebrand applies to `Development` only; other branches retain their existing names and routes.

For the exact Development URL, Azure callbacks, local ports, and branch-specific rules, see [URL_CONFIGURATION.md](URL_CONFIGURATION.md).

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
| `employee` | Personal time logging, draft review, and employee experience | `Development` |
| `manager` | AI-assisted review, delegated workflow rights, and messaging | `Development` |
| `admin` | Technology management, access administration, and operational visibility | `Development` |
| `messages` | Messaging behavior, chat controls, and contractor/account-manager groundwork | `Development` |
| `user_Interface` | Shared visual design and responsive interaction | `Development` |
| `testing` | Standalone testing framework and detailed test console | `Development` |
| `database_management` | Database initialization, migration planning, and future AI storage | `Development` |
| `Development` | Shared source of truth for integrated features and testing | `main` for releases |
| `main` | Reviewed release code | Receives release PRs from `Development` |

Keep feature branches after integration. `Per_user_entries` has been retired; use the three role branches for feature work. Branch names organize development, while authenticated roles and server-checked permissions determine the UI a person sees.

This README describes the Development-based checkout. It does not update `main`
or imply its features have been released. `messages` was merged into remote
`Development` at `8463b58`; database-management changes remain local and unmerged.

| Capability | Released baseline on `main` | Integrated in `Development` |
| --- | --- | --- |
| Microsoft sign-in and app access lists | Yes | Yes |
| AI note extraction, saved entries, and manager reports | Yes | Yes |
| Persistent account profiles | Yes | Yes |
| Draft/submission/approval workflow | Not yet | Yes |
| Database-managed roles and per-control rights | Not yet | Yes |
| Manager delegation and employee messages | Not yet | Yes |
| Audit detail windows and periodic AI risk reports | Not yet | Yes |
| Automated unit/component/API tests and test console | Not yet | Yes |
| Contractor role and account-manager scaffold | Not yet | Yes |
| Quiet message settings, search, and conversation filters | Not yet | Yes |
| Trusted-device automatic encryption unlock | No | Not implemented |
| Contractor payments and fund-release approval | No | Not implemented |
| Retry-safe database initialization improvements | No | Local `database_management` only |

## Role Workspaces

The following describes the integrated `Development` experience. Existing capabilities remain available unless a saved permission override explicitly restricts a control.

| Role | Main responsibilities |
| --- | --- |
| Contractor | Outsourced worker: log own time, submit work, correct rejected entries, and read authorized messages |
| Employee | Extract notes into drafts, review/edit eligible entries, submit or recall work, correct rejected entries, maintain a profile, and read authorized messages |
| Manager | Review team entries, ask AI to prepare recommendations, confirm approvals/rejections, use reports, delegate permitted workflow rights, and send individual or broadcast employee messages |
| Account Manager | Admin-assigned business-account category; no timesheet mutation or operational approval; financial workflow planned separately |
| Admin / technology manager | Manage identities, roles, and control permissions through Edit/Save; inspect audit details and stored AI security reports; retain existing entry and reporting capabilities |

Managers may delegate only workflow rights they hold. They cannot promote account roles, unblock employees, or delegate technical-admin access. Team visibility and approval are separate rights.

Permission changes are stored in the database. Same-browser tabs receive refresh notifications; other sessions refresh every 15 seconds and on focus. APIs check current rights on each request. Private messages are scoped to sender and recipient; employee broadcasts are scoped to eligible accounts.

AI recommendations are advisory. They cannot verify that work happened and do not automatically approve time, block accounts, or grant permissions.

## Local Setup

### Prerequisites

- Node.js 20.9 or later; Node.js 22 matches the test workflow.
- pnpm; the test workflow currently uses pnpm 12.4.2.
- A Neon PostgreSQL database, a Microsoft Entra application registration, and AI Gateway credentials for live AI operations.

```powershell
git clone https://github.com/OnCallSolutions/Time_logs.git
cd Time_logs
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
| `WORKER_EMAILS` | Legacy employee role configuration used by the released baseline; supported for compatibility in `Development` |
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

The automated framework is available on `Development` and the integrated role branches. The released baseline on `main` does not yet include its scripts.

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
another running server. The richer live table/detail console is on `testing`;
Development retains its existing console. Automated tests mock database/model
responses and do not establish that live Microsoft, Neon, or AI configuration works.
Test those integrations with distinct authorized contractor, employee, manager,
account-manager, and admin accounts.

Run TypeScript explicitly: the current Next.js configuration skips type failures during production builds, so a successful build alone is insufficient validation.

On `Development`, see `TESTING.md`, `ROLE_WORKSPACES.md`, and `BRANCH_OWNERSHIP.md` for detailed test cases and ownership guidance. Those documents are not part of the current released baseline.

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

`main` stores time entries and profiles. `Development` additionally stores managed access with JSONB permission overrides, audit events, security reports, and in-app messages. Schema helpers create required tables/columns idempotently; the database credential must permit those operations. Use separate development/test and production databases.

Local `database_management` adds retry-safe, process-cached schema initialization
and avoids replacing current access-role constraints on every cold start. It does
not yet provide versioned migrations, cursor pagination, or AI job storage. See
[DATABASE_MANAGEMENT.md](DATABASE_MANAGEMENT.md). No live database maintenance has
been performed during this groundwork.

## Deployment and Releases

1. Develop on the relevant role, messaging, UI, testing, or database branch, keeping shared changes aligned with `Development`.
2. Open feature PRs into `Development`; preserve the feature branches.
3. Validate the integrated application with automated checks and live role/permission tests.
4. Update the feature-status table for the release and open a PR from `Development` into `main`.
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
encryption controls live in Message settings. Recovery unlocking is still required
after reload because private keys are memory-only. Trusted-device unlock, OS-aware
themes, and the richer conversation controls remain future work.

New sends require every recipient to initialize encryption. Historical plaintext
may still exist; the quiet chat view does not label every bubble's encryption state.
See [MESSAGING_SECURITY.md](MESSAGING_SECURITY.md) for protocol limits and recovery
warnings. This custom development protocol is not WhatsApp's protocol and requires
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

Contributions should include suitable regression tests and maintain the project's multi-line Doxygen-style file/function documentation. Follow `AGENTS.md` and the installed Next.js guides when changing framework behavior.
