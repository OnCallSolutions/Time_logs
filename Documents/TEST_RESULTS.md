# Verification Record and Acceptance Worksheet

## Sessions and Review Reliability

2026-10-16: bounded session callbacks/storage, 30-minute idle warnings, eight-hour
absolute expiry, portal privacy shielding, atomic rejection, stale confirmation
snapshots and admin Operations navigation were verified in isolated tests. The full
suite contains 295 tests. Desktop (1440x1000) and mobile (390x844) synthetic browser
checks passed session warning/expiry, explicit renewal, Operations/Back and failed
rejection note/reference retention. Screenshots and viewport framing were checked.
Read-only SQL planning modeled one pending additive column; no live approval or
schema migration was executed. Authenticated production acceptance remains separate.

## Identity and Message History Update

2026-10-15: 264 unit/component/API tests passed, including ephemeral real-crypto
trusted-device transfers and organization recovery, onboarding guards, normalization,
and receipt styling. TypeScript passed. Synthetic Playwright desktop (1440x1000)
and mobile (390x844) checks passed bubble width/alignment, long-string wrapping,
failed-send display and explicit official-identity saving. Screenshots were inspected.
These checks do not certify live PostgreSQL concurrency or authenticated multi-device
delivery. Organization recovery requires separately configured private server keys.
The production build and anonymous Microsoft sign-in page smoke check also passed.

## Recorded Snapshot

2026-10-15: integrated Development application before this documentation refresh.
These results do not certify later changes or a deployed production environment.

| Check | Recorded result |
| --- | --- |
| Route type generation | Passed |
| Explicit TypeScript validation | Passed |
| Vitest | 187 tests passed across 53 files at the original snapshot |
| Production build | Passed |
| Authorized database reset | All 12 public application tables verified empty in the transaction; schema preserved |
| Production deployment | Not performed/verified by these checks |
| Live Microsoft, AI, multi-device acceptance | Not certified by mocked tests |

The reset targeted the database referenced by this repo's `.env.local`, not
Vercel logs, Entra records, or provider backups. Later use can create data again.
Environment lists remain; database-managed rights need configuring again.

## New Run Record

Entry-editor regression verification on 2026-10-15: 203 tests passed across 54
files, with explicit TypeScript validation passing. Disposable Playwright checks
used the actual components with synthetic local state at desktop/mobile sizes:
local typing, Cancel, Save, grouped identity, approval/rejection, and visible
confirmation controls passed. This was not a live authenticated database test.
The final production build and anonymous Microsoft sign-in browser smoke test
also passed. Live signed-in review and AI-provider acceptance remain separate.

Landing/submission regression verification on 2026-10-15: 224 tests passed across
57 files, with explicit TypeScript validation passing. Disposable browser checks
passed at desktop/mobile sizes for grouped commands, nested Back navigation,
owned selection, cancel without mutation, AI preparation without submission,
confirmed bulk submission, manager-to-account-manager routing, and admin controls.
These browser requests used synthetic in-memory responses; live AI and authenticated
database acceptance are not implied.
The final `pnpm verify` gate passed typecheck, all tests, and the production build.
Read-only AI preparation cancellation is tested; confirmed writes remain protected
from dismissal while in progress.

2026-10-16 Development: `pnpm verify` passed with 295 tests across 74 files and a
successful production build. Added company-scoped human references, normalized
official identities, rights refresh ordering, assistant action proposals, and
timesheet submission diagnostics. Authenticated local submission and permission
changes were not exercised against a live database; perform that acceptance after
sign-in before release.

Record date, tester, branch/commit, environment, app URL, commands, and safe failure
summaries. Use Passed / Failed / Not tested. Never include credentials, connection
strings, private keys, or message plaintext. Do not carry results forward without rerunning.

| Area | Required acceptance cases | New result |
| --- | --- | --- |
| Authentication | Exact callback, allowed/denied accounts, logout/reauthentication | Not tested |
| Contractor | Own-name samples, drafts, project work units, submission, ownership | Not tested |
| Employee | Personal workflow and explicitly delegated controls | Not tested |
| Manager | Selection, confirmation/cancel, rejection reason, no self-review | Not tested |
| Account manager | Assigned scope, triage notes/version checks, manager-review grant | Not tested |
| Admin | Edit/Save, revocation, last-admin protection | Not tested |
| Lifecycle | Cutoff, suspension, reactivation, temporary grant expiry | Not tested |
| Messaging | Automatic enrollment, audiences, receipts, one-hour edit/delete | Not tested |
| Devices | Future-message access, unavailable history, no plaintext fallback | Not tested |
| AI | Correct lane, safe failures, stale-source rejection, human confirmation | Not tested |
| Accounts | Contractor/employee handoff, stale evidence, no payment execution | Not tested |
| Audit/security | Compact rows, selected IP/JSON, admin-only reports | Not tested |
| Responsive UI | Mobile/desktop, windows, Back, scrolling, visible actions | Not tested |
| Deployment | Intended commit, environment scope, live smoke test | Not tested |

## Release Decision

Record unresolved failures and the approving reviewer. Builds do not replace
typechecks, authorization tests, live integration checks, or independent
cryptographic review. See [testing](TESTING.md).
