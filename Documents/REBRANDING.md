# Tanovo Time Names and URLs

| Item | Current value |
| --- | --- |
| Product / parent organization | Tanovo Time / DevOnCall |
| Package and local directory | `tanovo-time` |
| Application path | `/tanovo-time` |
| Vercel project | `tanovo-time` |
| Git remote | `https://github.com/OnCallSolutions/Time_logs.git` |
| Retained branches | `Development`, `main` |

Brand settings originated in the remote rebrand PR; its route typo was corrected
to `/tanovo-time` without replacing integrated functionality. The rebrand branch
is retired. Both retained branches contain the integrated rebranded application;
an older deployed snapshot may still serve older code.

The local directory is `C:\Users\otien\Documents\tanovo-time`. Folder, remote
repository, Vercel project, application path, and Entra display name are independent.
The Git repository has not been renamed merely because the local folder changed.

## Exact Development Configuration

`AUTH_URL=https://tanovo-time-git-development-devoncall.vercel.app`

Scope that override to Preview and branch `Development`. The app is that origin
plus `/tanovo-time`; the Entra Web callback is:

```text
https://tanovo-time-git-development-devoncall.vercel.app/tanovo-time/api/auth/callback/microsoft-entra-id
```

Production uses its actual confirmed assigned hostname, not Development's origin.
See [URL configuration](URL_CONFIGURATION.md) for local ports and exact callbacks.

## Future Migration Checklist

1. Confirm any remote repository rename before changing its Git remote URL.
2. Verify Vercel's connected repository and assigned stable/production domains.
3. Preserve the existing Entra client ID, issuer, and valid secret; update display
   branding separately from exact Web callback registrations.
4. Align code paths, assets, auth base, scheduled endpoint, and docs.
5. Set environment-specific origins and deploy the intended source commit.
6. Verify sign-in/out, role controls, messages, assets, and monitoring.

Environment changes do not update old deployments. Avoid deployment-specific hash
URLs for OAuth. No database reset is required for rebranding; the separately
authorized fresh-start reset is recorded in [database management](DATABASE_MANAGEMENT.md).

A new hostname/port has separate browser storage. Sign-in automatically enrolls
a device there, but old encrypted history does not automatically transfer.
There is no normal recovery-phrase step.
