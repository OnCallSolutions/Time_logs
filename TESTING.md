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
pnpm test:e2e:url https://your-branch.vercel.app/timelog
pnpm test:ui
pnpm verify
```

`pnpm verify` is the everyday approval gate: TypeScript, Vitest, and production build.

`pnpm test:e2e` runs browser tests in `e2e/` against the local app. Run `pnpm test:install` once on a new machine to install Chromium.

`pnpm test:e2e:url <url>` runs the same browser smoke tests against any deployed branch page URL. Include `/timelog` in the URL.

`pnpm test:ui` starts the standalone ONCALL Test Console at `http://127.0.0.1:4317`. This is not part of the app. It is a local dashboard with buttons and event listeners for local verification, coverage, local browser smoke tests, and deployed branch URL smoke tests. You can launch it from PowerShell, Command Prompt, or the VS Code terminal.

## Current Coverage

The first baseline covers the authorization rules and the admin role/permission edit workflow. Coverage is intentionally reported but not failed by thresholds yet because the codebase is starting from low test coverage. Add thresholds after the next few critical areas are covered.

## Branch Scope

The framework is branch-agnostic. The package scripts and GitHub Actions workflow are intended to run on every previous, current, and future branch once this testing branch is merged or cherry-picked into that branch. The dashboard also accepts any deployed branch preview URL, so it can test older branch deployments even when the local checkout is on a different branch.

## What To Add Next

- API route tests for entries, approvals, audit events, and users.
- Database helper tests with a disposable test database or query mocks.
- Authenticated Playwright flows once a dedicated test Microsoft/DB environment exists.
- Regression tests for every production bug before fixing it.
