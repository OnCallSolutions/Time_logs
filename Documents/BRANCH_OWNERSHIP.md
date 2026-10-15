# Branch and Release Ownership

Only `Development` and `main` are retained locally and remotely. All feature
branches were integrated and retired; their commits remain in Git history.

| Branch | Responsibility |
| --- | --- |
| `Development` | Integrated UI, business logic, tests, and documentation |
| `main` | Reviewed releases, receiving Development-to-main pull requests |

Runtime roles are authorization boundaries, not Git branches. Do not follow old
instructions to check out role, UI, messages, security, testing, or rebrand branches.

## Release Process

1. Review the integrated diff and preserve unrelated work.
2. Generate route types if needed; run typecheck, tests, and production build.
3. Validate affected roles and live integrations using separate test accounts.
4. Open a reviewed PR from Development to main.
5. Verify the deployed commit and configuration independently.

Automatic Vercel Git deployment is enabled only for main in `vercel.json`.
Deploy Development Preview manually from the intended commit. A merge or build
does not certify a production deployment.

## Configuration Boundaries

Managed roles and rights belong in `managed_user_access`, not Vercel secrets.
Adding an active account does not require redeployment, but does not create an
Entra account, tenant guest, or application assignment.

Deployment credentials remain server-only. Audit/security controls remain
admin-only. IPs and full metadata belong in selected-event details. Scheduled
AI assessments are advisory, not automatic permission changes or comprehensive
infrastructure monitoring. See [URL configuration](URL_CONFIGURATION.md).
