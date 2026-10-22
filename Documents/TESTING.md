# Testing

This project uses a layered testing setup:

- Vitest for fast unit and component tests.
- React Testing Library for user-facing component behavior.
- Playwright for browser-level smoke and future end-to-end flows.
- GitHub Actions to run checks automatically on pushes and pull requests.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:install
pnpm test:e2e
pnpm test:e2e:url https://your-branch.vercel.app/tanovo-time
pnpm test:ui
pnpm verify
```

`pnpm verify` is the everyday approval gate: TypeScript, Vitest, and production build.

`pnpm test:e2e` runs browser tests in `e2e/` against the local app. Run `pnpm test:install` once on a new machine to install Chromium.

`pnpm test:e2e:url <url>` runs the same browser smoke tests against any deployed branch page URL. Include `/tanovo-time` in the URL.

`pnpm test:ui` starts the standalone ONCALL Test Console at `http://127.0.0.1:4317`. This is not part of the app. It is a local dashboard with buttons and event listeners for local verification, coverage, local browser smoke tests, and deployed branch URL smoke tests. You can launch it from PowerShell, Command Prompt, or the VS Code terminal.

## Live Console

The console discovers runnable Vitest and Playwright cases before execution,
including parameterized cases with duplicate names. The table groups cases by
Unit, API, UI, Browser, and Checks, with separate feature-area filters. Results
update through queued, running, passed, failed, skipped, and flaky states.
TypeScript and production builds appear as separate checks.

Search, Category, Area, and Status narrow the table. Each row opens a full-screen
diagnostics window; Back returns to the table. Logs, recent in-memory run history,
and JSON export are available. Refresh tests recollects the inventory; file
watchers invalidate it when test sources change.

Details now include concise purpose, rationale, referenced target functions,
test cases, and setup explanations, followed by exact file fixtures, selected
case code, and shared runner setup. These are parsed from the current checkout
without executing test source. History results are not immutable source snapshots;
switching branches blocks explanations for runs from another branch. Dynamically
generated titles that cannot be matched are explicitly marked, not guessed.

Only one command runs at a time. The server binds to loopback and rejects
cross-origin commands and non-loopback Host headers. It never checks out, merges,
or pushes branches. Local commands test the current checkout. Browser targets
must be credential-free HTTP(S) URLs; local targets must use loopback hostnames.
The deployment branch selector labels the target; it does not switch source.

Collection loads test modules but does not execute test callbacks. Keep module
initialization free of production side effects. Authenticated Microsoft flows,
live database concurrency, and external AI calls require dedicated integration
environments; smoke tests do not approve those systems.

## Current Coverage

Tests cover authorization, roles/rights, lifecycle, entries and review, account
handoffs, AI failure/revision checks, crypto/device enrollment, messaging, UI controls,
and test-console behavior. See [recorded results](TEST_RESULTS.md) for the dated
test-count snapshot. Coverage is reported without a failing percentage threshold;
this is not evidence of complete coverage.

## Branch Scope

Development and main contain the integrated framework. Only these two branches
are retained. The console runs commands against the current checkout; its branch
selector labels a browser target and never checks out source.

Run commands from the repository root, not Documents. Generate missing route
types with `pnpm exec next typegen` before a fresh `pnpm typecheck`.
Port 3000 is interactive development, 3002 a separately configured built app,
3100 the isolated Playwright server, and 4317 the external test console.
See [URL configuration](URL_CONFIGURATION.md); ports alone do not isolate cookies.

CI uses Node 22/pnpm 12.4.2 and runs typecheck, coverage, build, and Chromium smoke
tests on pushes/pull requests. It uses test configuration, not live production
credentials. Live OAuth and production database/provider behavior are not certified.

## What To Add Next

- Expand existing API regression coverage for failure/concurrency paths.
- Add disposable PostgreSQL integration and migration/backup-restore tests.
- Authenticated Playwright flows once a dedicated test Microsoft/DB environment exists.
- Regression tests for every production bug before fixing it.
