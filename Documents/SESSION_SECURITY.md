# Bounded Session Remembrance

## Approved Policy

The application remembers an authenticated browser for brief returns, but expires
after **30 minutes without interaction**, with a **2-minute warning**. No session
can exceed **8 hours from its original Microsoft sign-in**. The hard limit cannot
be extended with Stay signed in, repeated API calls or client token updates.

An existing live session may therefore reopen without a password during that short
window. Browser/tab closure is not a dependable logout signal: browsers can restore
cookies, crash, suspend background tabs or retain a profile. Explicitly sign out
and lock the operating-system screen on shared/unattended devices. The application
cannot determine whether a different human is using an already unlocked browser.

## Implementation

Auth.js uses an 8-hour encrypted JWT cookie, bound to a random server-issued record
in `app_signin_sessions`. Every auth resolution validates its account, revocation,
last activity and original creation time. Reads never update last activity. Tokens
without the new bounded-session ID require a fresh sign-in on rollout; legacy
long-lived cookies are not silently upgraded into fresh sessions.

The page wraps the workspace in `SessionBoundary`. It shields stale UI during checks
on restoration/visibility changes and sends throttled activity only after real input
or an explicit Stay signed in action. Inbox, permission and history polling do not
renew idle time. User timestamps, IDs or token-update payloads cannot select a new
session. `POST /tanovo-time/api/session-activity` requires the same browser Origin;
GET only returns authoritative deadlines. Expired sessions cannot be revived.

At expiry, the workspace unmounts, plaintext in component memory is discarded,
client request caches are invalidated and the page returns to sign-in. Saved browser
encryption identities remain available for the same user's future authenticated
sessions. Unsaved work is not uploaded automatically; the warning gives time to save.
Verification failures shield the workspace and offer Retry instead of allowing
unverified controls. Server-side authorization remains authoritative if JavaScript
is disabled or browser timers are suspended.

The privacy shield covers body-level dialog portals as well as the main workspace;
an already-open review window is not left exposed during verification. Client
transport failures offer Retry. A backing-store failure during token validation
fails closed and may require Microsoft reauthentication after service is restored.
The boundary also checks the authenticated account identity; switching accounts
in another tab clears the old workspace instead of mixing names, drafts or messages.

Sign-out attempts server revocation and clears Auth.js/legacy cookie paths even if
the logout request fails. Revocation depends on database availability; copied
cookies cannot be promised revoked during an outage. Session validation itself fails
closed during storage failure. Normal sign-out does not globally sign the person
out of unrelated Microsoft applications.

## Microsoft Authentication

The existing Microsoft Entra ID provider, route and `prompt=login`/`max_age=0`
sign-in parameters remain. Expired users must start authentication again. The app
does not itself enforce Microsoft MFA or override operating-system/federated sign-in
policy; configure those separately in Entra Conditional Access where required.

References: [Auth.js session options](https://authjs.dev/reference/core),
[Microsoft OIDC login prompt](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc).

## Verification and Operations

Policy, auth-callback, SQL-storage, activity-route and boundary tests cover exact
expiry, polling, forged renewal IDs, logout and visible warnings. Schema creation
is additive/lazy, not a database reset. Session-record retention/cleanup and a
user-facing all-devices revocation screen are future operations work.
Authenticated multi-browser expiry/logout still needs staging acceptance; mocked
session tests and the anonymous Microsoft sign-in smoke do not certify that flow.
