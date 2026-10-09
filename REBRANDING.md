# TanovoTime Deployment Migration

TanovoTime is the product name; DevOnCall remains the parent organization. The
application path is `/tanovotime`, including API endpoints, images, authentication,
and scheduled security monitoring. Microsoft Entra ID remains required.

The source changes apply to `Development` only. Remote service renames, remote
URLs, production deployments, and other branches have not been changed. Do not
merge the rebrand into other branches as part of this task. Repository and Vercel
project names are shared remote settings, while application paths depend on each
branch's code. Keep the existing routes and callback URIs for branches that have
not been migrated.

Use `/tanovotime` only on deployments built from this rebranded `Development`
code. Production remains on its released branch's existing path until a separate,
approved release. Renaming a shared remote project does not update branch code.

## 1. Rename the GitHub Repository

Your current repository is `maurice-devnet/ONCALL_SOLUTIONS`. On GitHub, open its
Settings, change Repository name to `tanovotime`, and select Rename. Rename the
existing repository instead of creating an empty replacement; history stays in
the same repository. Then run these commands from the current local checkout:

```powershell
git remote set-url origin https://github.com/maurice-devnet/tanovotime.git
git remote -v
git fetch origin
```

Do not run the set-url command until the GitHub rename is complete. The local
folder can remain `ONCALL_SOLUTIONS`; renaming that folder is optional and does
not change the Git remote. If renamed, stop local servers, close the workspace,
rename it in File Explorer, and reopen/update the saved project in your editor.
Afterward, update the README clone example to the new repository URL and folder.

[GitHub repository rename instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

## 2. Rename the Existing Vercel Project

Open the existing project, then Settings > General. Change its Project Name to
`tanovotime` and save. Keep the existing project so its environment configuration
and linked database remain available. Do not delete and recreate it.

In Settings > Git, verify the connected repository after the GitHub rename. Keep
the Production Branch unchanged unless deliberately changing your release policy.
`Development` can remain the integration/preview branch while `main` is production.

In Settings > Domains, confirm/add the new production domain and the stable
branch aliases you will actually use. A project rename is not proof that a
particular hostname is available or assigned. Copy the domains Vercel shows; do
not assume `tanovotime.vercel.app` is yours. Use a stable branch alias or a custom
domain assigned to the branch, not a deployment-specific hash URL.

Example only, if Vercel assigns it:

```text
https://tanovotime.vercel.app/tanovotime
```

[Vercel project rename instructions](https://vercel.com/kb/guide/how-do-i-change-the-name-of-my-vercel-project).
[Git integration](https://vercel.com/docs/git/vercel-for-github).

## 3. Update the Existing Azure / Entra App

Use the existing Entra app registration. In App registrations > your application
> Branding & properties, change the display name to `TanovoTime` and save. Update
the corresponding Enterprise application > Properties name if it still shows
the previous product name. This does not require renaming the DevOnCall tenant.

In Authentication, add these exact redirect URIs under the **Web** platform:

```text
http://localhost:3000/tanovotime/api/auth/callback/microsoft-entra-id
https://<ACTUAL-PRODUCTION-HOST>/tanovotime/api/auth/callback/microsoft-entra-id
https://<ACTUAL-STABLE-PREVIEW-HOST>/tanovotime/api/auth/callback/microsoft-entra-id
```

Replace the placeholders with confirmed Vercel/custom hostnames. Add a separate
URI for each active branch host you test. Do not register the landing page or
the sign-in endpoint as the callback. Keep callbacks for still-active deployments
until those deployments have been migrated; then remove obsolete callbacks.

Keep the client ID, tenant issuer, permissions, account types, assignments, and
current valid secret unchanged. Do not create a new client secret merely to
rename the app. Do not change the Application ID URI under Expose an API as part
of this URL migration. If a homepage URL is configured, update it to the actual
production origin plus `/tanovotime`. Do not add a front-channel logout URL unless
you have an endpoint that implements that protocol.

[Microsoft redirect URI procedure](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
[App names](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
[Enterprise application properties](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/application-properties).

## 4. Set Canonical Origins and Redeploy

This app configures Auth.js's path in code. Set `AUTH_URL` to the origin only,
without `/tanovotime`, `/api/auth`, query parameters, or a trailing path:

```dotenv
# Local .env.local
AUTH_URL=http://localhost:3000

# Vercel Production: replace with your actual assigned hostname
AUTH_URL=https://<ACTUAL-PRODUCTION-HOST>

# Vercel Preview: branch-specific override, not one shared preview hostname
AUTH_URL=https://<ACTUAL-STABLE-PREVIEW-HOST>
```

In Settings > Environment Variables, verify these server-only values are present
for each required environment:

```text
AUTH_SECRET
AUTH_MICROSOFT_ENTRA_ID_ID
AUTH_MICROSOFT_ENTRA_ID_SECRET
AUTH_MICROSOFT_ENTRA_ID_ISSUER
DATABASE_URL
CRON_SECRET
```

Preserve AI credentials, role/allowlist variables, and existing database contents.
Never prefix secrets with `NEXT_PUBLIC_` or commit `.env.local`. Shared Preview
secrets may serve multiple branches, but override `AUTH_URL` separately for each
branch. Update any stale `NEXTAUTH_URL` legacy value if you have configured one.

Register the confirmed stable hosts in Entra before deploying the new path.
Rebuild/redeploy after changing environment variables or the base path; older
deployments do not pick up these changes. Do not repeatedly chase hash deployment
URLs. If an older branch is still deployed, its callback must match that branch's
actual code path until it is upgraded.

[Vercel environment variables and branch overrides](https://vercel.com/docs/environment-variables).

## 5. Verify the Migration

Stop the old local server and rebuild the current checkout:

```powershell
pnpm verify
pnpm start
# Then open http://localhost:3000/tanovotime
```

If port 3000 is occupied, use `pnpm start --port 3002`. For authentication on that
port, also change local `AUTH_URL` to `http://localhost:3002` and register its exact
callback in Entra. Restore those settings when returning to port 3000.

Verify root navigation, Microsoft sign-in, sign-out, each role's navigation,
messages, profile assets, and scheduled security monitoring. The cron path in
`vercel.json` is now `/tanovotime/api/security?scheduled=1`. Database tables and
employee permissions do not need renaming; do not reset the database.

A changed hostname is a new browser origin. Cookies and local encrypted-message
identity pins do not transfer automatically. Users may need to sign in again and
unlock encrypted messages with their recovery passphrase. Old bookmarks should
be updated; no obsolete application-path alias was retained in this rebrand.
