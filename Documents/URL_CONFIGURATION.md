# URL Configuration

This map applies to rebranded `Development`. Hostname, application path, and
authentication callback are different settings. Do not interchange them.

## Development on Vercel

| Setting | Exact value |
| --- | --- |
| Stable origin / branch-specific Preview `AUTH_URL` | `https://tanovo-time-git-development-devoncall.vercel.app` |
| Application / browser test target | `https://tanovo-time-git-development-devoncall.vercel.app/tanovo-time` |
| Azure Web redirect URI | `https://tanovo-time-git-development-devoncall.vercel.app/tanovo-time/api/auth/callback/microsoft-entra-id` |
| Auth.js public API base (configured in code) | `/tanovo-time/api/auth` |
| Next.js application base (configured in code) | `/tanovo-time` |

The confirmed hostname uses `tanovo-time`, matching the renamed Vercel project.
Use this stable alias instead of deployment-specific hash domains.

In Vercel Environment Variables, scope the `AUTH_URL` override to the Preview
environment and branch `Development`. Do not apply this origin to all branches
or Production. Remove a stale `NEXTAUTH_URL`, or make it agree with `AUTH_URL`.
Keep authentication secrets server-only. Redeploy after changing settings.

## Local Ports

| Purpose | Command | Address |
| --- | --- | --- |
| Interactive development | `pnpm dev --port 3000` | `http://localhost:3000/tanovo-time` |
| Built application | `pnpm build`, then `pnpm start --port 3002` | `http://localhost:3002/tanovo-time` |
| Automated local browser tests | `pnpm test:e2e:local` | `http://localhost:3100/tanovo-time` (managed by Playwright) |
| Standalone test console | `pnpm test:ui` | `http://127.0.0.1:4317/` |

Playwright refuses to reuse an existing port-3100 server, avoiding tests against
the wrong running branch. Its output goes into `.next-e2e`, separate from the
regular `.next` build. Port 4317 is a testing tool, not the application, and
must never be used as an Entra callback or `AUTH_URL`.

For real Microsoft sign-in, set local `AUTH_URL` to the running app's origin
only: `http://localhost:3000` or `http://localhost:3002`. Restart the server after
changing it. Do not use `127.0.0.1` for app login when the configured origin and
callback use `localhost`; they have different cookie origins.

Register these Azure Web callbacks for the local app ports you actually use:

```text
http://localhost:3000/tanovo-time/api/auth/callback/microsoft-entra-id
http://localhost:3002/tanovo-time/api/auth/callback/microsoft-entra-id
```

The current automated browser smoke test does not complete Microsoft login.
Only if extending it to live OAuth, register the separate port-3100 callback:
`http://localhost:3100/tanovo-time/api/auth/callback/microsoft-entra-id`.

Test an already running app or deployment without starting another server:

```powershell
pnpm test:e2e:url http://localhost:3002/tanovo-time
pnpm test:e2e:url https://tanovo-time-git-development-devoncall.vercel.app/tanovo-time
```

## Other Branches and Production

Only Development has been migrated. Unmigrated branches use their own
`next.config.mjs` base path (currently `/timelog` on role branches). Keep their
existing callbacks until their code is explicitly migrated. The preserved
`rebrand` branch contains historical source with a misspelled route; use
Development for the corrected application, not that historical branch.

Production must use its actual assigned origin and released branch's path.
Do not copy the Development hostname into Production `AUTH_URL`.

For simultaneous branch testing, use separate Git worktrees and different
ports, each with its own ignored local environment file. Ports alone do not
isolate source files or builds within a single checkout. Rebuild before using
`pnpm start` after switching branches. Cookies are not isolated by port: use
separate browser profiles to isolate signed-in sessions across branches.

## Azure Location

Open https://entra.microsoft.com/ and select App registrations, the existing
application, Authentication, then the Web platform. Add the exact callback
URIs above, not the app landing page or `/signin` endpoint. Leave the client
ID, valid secret, issuer, tenant, and permissions unchanged.

## Repository URLs Are Separate

The verified Git remote is `https://github.com/OnCallSolutions/Time_logs.git`.
The local folder is `tanovo-time`. Folder and repository names do not control
Next.js routes or Entra callbacks; renaming either does not require changing
authentication credentials.
