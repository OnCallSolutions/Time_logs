# TanovoTime

AI-assisted time logging, review, and employee administration built with Next.js, Microsoft Entra ID, and Neon PostgreSQL.

**AI prepares the work; people review and confirm decisions.** The application is served at `/tanovotime`.

For GitHub, Vercel, and Microsoft Entra name/URL migration, see [REBRANDING.md](REBRANDING.md). This rebrand applies to `Development` only; other branches retain their existing names and routes.

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
| `Development` | Shared source of truth for integrated features and testing | `main` for releases |
| `main` | Reviewed release code | Receives release PRs from `Development` |

Keep feature branches after integration. `Per_user_entries` has been retired; use the three role branches for feature work. Branch names organize development, while authenticated roles and server-checked permissions determine the UI a person sees.

This README is shared by `main` and `Development`. Features described as development features are not released simply because they appear in this document.

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

## Role Workspaces

The following describes the integrated `Development` experience. Existing capabilities remain available unless a saved permission override explicitly restricts a control.

| Role | Main responsibilities |
| --- | --- |
| Employee | Extract notes into drafts, review/edit eligible entries, submit or recall work, correct rejected entries, maintain a profile, and read authorized messages |
| Manager | Review team entries, ask AI to prepare recommendations, confirm approvals/rejections, use reports, delegate permitted workflow rights, and send individual or broadcast employee messages |
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
git clone https://github.com/maurice-devnet/ONCALL_SOLUTIONS.git
cd ONCALL_SOLUTIONS
git switch Development
pnpm install --frozen-lockfile
```

Create an untracked `.env.local` with the values described below, then start the development server:

```powershell
pnpm dev
```

Open [http://localhost:3000/tanovotime](http://localhost:3000/tanovotime).

For a production-style local run:

```powershell
pnpm build
pnpm start
```

Stop the server before changing branches and rebuild before using `pnpm start`. A build from another branch can show stale features or routes.

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
| `ADMIN_EMAILS` | Admin bootstrap/recovery identities |
| `MANAGER_EMAILS` | Optional environment-backed manager identities |
| `EMPLOYEE_EMAILS` | Employee identities in `Development` |
| `WORKER_EMAILS` | Legacy employee role configuration used by the released baseline; supported for compatibility in `Development` |
| `CRON_SECRET` | Server-only authentication token for scheduled security monitoring in `Development` |

Configure explicit access lists for restricted environments. Without environment access lists, the current policy may allow authenticated Microsoft accounts by default. In `Development`, managed active/denied/blocked assignments participate in access resolution; environment recovery admins remain a recovery path.

### Microsoft Redirect URIs

Register these as **Web** redirect URIs in the same Entra application used by the deployment:

```text
http://localhost:3000/tanovotime/api/auth/callback/microsoft-entra-id
https://<stable-deployment-domain>/tanovotime/api/auth/callback/microsoft-entra-id
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
| `pnpm test:e2e:url <url>` | Browser smoke test against a deployed `/tanovotime` URL |
| `pnpm test:ui` | Standalone local test console, outside the application |

The test console runs at `http://127.0.0.1:4317`. Automated tests mock database/model responses; they do not establish that a live Microsoft, Neon, or AI configuration works. Test those integrations with distinct authorized employee, manager, and admin accounts.

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
| `next.config.mjs` / `lib/paths.ts` | `/tanovotime` routing configuration |
| `e2e/`, `tests/`, `tools/` | Automated tests and external test tools in `Development` |

`main` stores time entries and profiles. `Development` additionally stores managed access with JSONB permission overrides, audit events, security reports, and in-app messages. Schema helpers create required tables/columns idempotently; the database credential must permit those operations. Use separate development/test and production databases.

## Deployment and Releases

1. Develop on `employee`, `manager`, or `admin`, keeping shared changes aligned with `Development`.
2. Open feature PRs into `Development`; preserve the feature branches.
3. Validate the integrated application with automated checks and live role/permission tests.
4. Update the feature-status table for the release and open a PR from `Development` into `main`.
5. Configure production secrets, Microsoft redirect URIs, and database access before deploying the release.

Vercel environment changes require a new deployment to take effect. Employee rights stored in the database do not require environment-variable changes or a redeploy.

The development security monitor is configured for daily execution at 06:00 UTC. Vercel cron executes on production deployments, not previews. Preview/local monitoring must be invoked separately with the configured bearer secret. Reports inspect at most 250 recorded events from the previous 24 hours and expose coverage limitations; this is not comprehensive malware or infrastructure monitoring.

The manager AI review endpoint processes up to 50 submitted records per request. Humans must confirm each resulting workflow decision.

## Security and Troubleshooting

The local `user_Interface` messaging update adds one-hour sender editing, confirmed deletion, delivery/read receipts, unread badges, optional in-app popups/sound, and client-side encryption with passphrase-protected multi-device recovery. New sends require every recipient to initialize encryption. Existing plaintext is explicitly labeled legacy. See [MESSAGING_SECURITY.md](MESSAGING_SECURITY.md) for the protocol, storage changes, operating limits, recovery warnings, and required independent security review before production use. This feature is not yet merged into `Development` or released on `main`.

- Keep secrets server-side and `.env.local` untracked. Rotate any credential that has been exposed; hiding a file later does not remove it from Git history.
- Technical audit/security tools remain admin-only. IP addresses and full audit JSON appear in selected-event details rather than compact activity rows.
- Local IP values such as `::1` or `127.0.0.1` represent loopback, not a missing address.
- `EADDRINUSE` means another process owns the server port. Stop that server before starting another, or use a different port and update matching auth/redirect configuration.
- A missing production build requires `pnpm build` before `pnpm start`.
- For 404s or stale pages after switching branches, stop the server and rebuild; use `/tanovotime` consistently.
- For authentication configuration errors, verify environment scope, client-secret value, issuer, and exact redirect URI. A personal Microsoft account may need tenant invitation or a compatible app registration.
- For unavailable AI analysis, verify AI Gateway authentication. Manual review remains available.

Contributions should include suitable regression tests and maintain the project's multi-line Doxygen-style file/function documentation. Follow `AGENTS.md` and the installed Next.js guides when changing framework behavior.
