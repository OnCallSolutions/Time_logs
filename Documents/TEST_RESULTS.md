# Tanovo Time Test Results

Date:
Tester:
Environment:
Build/commit:

## Summary

| Area | Result | Notes |
| --- | --- | --- |
| Local build | Not tested |  |
| Local authentication | Not tested |  |
| Logout/login back in | Not tested |  |
| Allowlist blocking | Not tested |  |
| Role access | Not tested |  |
| Neon persistence | Not tested |  |
| API protection | Not tested |  |
| Production smoke test | Not tested |  |

Ready for production:

## Environment Configuration

| Key | Local present | Vercel present | Notes |
| --- | --- | --- | --- |
| DATABASE_URL        |  |  |  |
| AI_GATEWAY_API_KEY |  |  |  |
| AUTH_SECRET |  |  |  |
| AUTH_URL |  |  |  |
| AUTH_MICROSOFT_ENTRA_ID_ID |  |  |  |
| AUTH_MICROSOFT_ENTRA_ID_SECRET |  |  |  |
| AUTH_MICROSOFT_ENTRA_ID_ISSUER |  |  |  |
| ALLOWED_EMAILS |  |  |  |
| ADMIN_EMAILS |  |  |  |
| MANAGER_EMAILS |  |  |  |
| CONTRACTOR_EMAILS |  |  |  |

## 1. Build And Startup

Commands:

```powershell
pnpm exec tsc --noEmit
pnpm build
pnpm start
```

Expected:

- TypeScript passes.
- Production build passes.
- App opens at `http://localhost:3000/tanovo-time`.
- Sign-in screen is shown.

Actual:

Pass/Fail:

Notes:

## 2. Allowed User Login

Account used:

Expected:

- Microsoft login succeeds.
- User returns to `/tanovo-time`.
- App loads the timesheet.
- Header shows the signed-in user and role.

Actual:

Role shown:

Pass/Fail:

Notes:

## 3. Logout And Login Back In

Account used:

Expected:

- Clicking Sign out returns to the sign-in screen.
- User can sign in again.
- Session is restored only after signing in again.

Actual:

Pass/Fail:

Notes:

## 4. Unapproved User Blocking

Account used:

Expected:

- Microsoft login may succeed.
- App shows `Access not approved`.
- Timesheet is not shown.
- Entries API does not return data.

Actual:

Pass/Fail:

Notes:

## 5. Role Access

| Account | Expected role | Role shown | Expected access | Actual access | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
|  | admin |  | See/manage all entries |  |  |
|  | manager |  | See/manage all entries |  |  |
|  | worker |  | See/manage own entries only |  |  |
|  | user |  | See/manage own entries only |  |  |
|  | unapproved |  | Blocked |  |  |

Notes:

## 6. Timesheet Save Test

Sample notes:

```text
Maria Alvarez: Mon worked 9-5 on the Acme website redesign, Tue only a half day (sick).
Deepak logged full days Wednesday and Thursday building the payments API for Northwind.
Sarah — Friday, roughly 6 hrs, QA testing + a client call for the Acme project.
Tom did 3 hours of on-call support yesterday, nothing else this week.
```

Expected:

- AI extraction succeeds.
- Entries appear in the table.
- Refreshing the page keeps the entries.
- Entries belong to the signed-in user.

Actual:
Entry count:
Pass/Fail:
Notes:
## 7. Neon Database Verification
Command:
```powershell
pnpm db:entries
```
Expected:

- `time_entries` rows are visible.
- New rows match the saved app entries.
- Rows include expected contractor/project/hour data.

Actual:

Pass/Fail:

Notes:

## 8. Direct API Access While Logged Out

Command:

```powershell
Invoke-WebRequest http://localhost:3000/tanovo-time/api/entries -SkipHttpErrorCheck
```

Expected:

- Status is `401`.
- Response does not include saved entries.

Actual:

Pass/Fail:

Notes:

## 9. Worker Isolation

Worker A account:

Worker B account:

Expected:

- Worker A sees only Worker A entries.
- Worker B sees only Worker B entries.
- Admin/manager can see both users' entries.

Actual:

Pass/Fail:

Notes:

## 10. Edit/Delete Permissions

Expected:

- Worker can edit/delete own entries.
- Worker cannot edit/delete another user's entries.
- Admin/manager can edit/delete any entry.

Actual:

Pass/Fail:

Notes:

## 11. Production Smoke Test

Production URL:

Expected:

- Production sign-in works.
- Logout works.
- Login back in works.
- Allowed users can access the app.
- Unapproved users are blocked.
- Entries save to Neon.
- Refresh keeps entries.

Actual:

Pass/Fail:

Notes:

## 12. Security Checklist

| Check | Result | Notes |
| --- | --- | --- |
| `.env.local` is not committed | Not tested |  |
| No secrets are present in committed files | Not tested |  |
| Azure redirect URI matches local URL | Not tested |  |
| Azure redirect URI matches production URL | Not tested |  |
| API blocks logged-out users | Not tested |  |
| API blocks unapproved users | Not tested |  |
| Worker cannot see other worker data | Not tested |  |
| Admin/manager can see all entries | Not tested |  |
| Production env vars are set in Vercel | Not tested |  |

## Known Issues

- 

## Follow-Ups

- 
