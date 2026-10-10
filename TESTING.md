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

The first baseline covers the authorization rules and the admin role/permission edit workflow. Coverage is intentionally reported but not failed by thresholds yet because the codebase is starting from low test coverage. Add thresholds after the next few critical areas are covered.

## Branch Scope

The framework is branch-agnostic. The package scripts and GitHub Actions workflow are intended to run on every previous, current, and future branch once this testing branch is merged or cherry-picked into that branch. The dashboard also accepts any deployed branch preview URL, so it can test older branch deployments even when the local checkout is on a different branch.

## What To Add Next

- API route tests for entries, approvals, audit events, and users.
- Database helper tests with a disposable test database or query mocks.
- Authenticated Playwright flows once a dedicated test Microsoft/DB environment exists.
- Regression tests for every production bug before fixing it.
