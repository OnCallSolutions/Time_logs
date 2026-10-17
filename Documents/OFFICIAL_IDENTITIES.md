# Official Company Identities

Managers and admins use **Add contractor/employee** to create baseline accounts
with an official name, email and category. Explicit Save atomically creates both
identity and access. Managers cannot overwrite existing accounts, unblock people
or assign elevated roles here. Existing admin rights editing remains separate.

## Normalization and Uniqueness

Official names are 2-80 characters after Unicode/whitespace normalization. Each
word and apostrophe/hyphen-separated segment begins uppercase; other letters are
lowercase. Letters, marks, spaces, apostrophes and hyphens are accepted. Emails are
trimmed, Unicode-normalized, validated and lowercased. Provider-specific plus/dot
aliases are not merged automatically.

Database constraints independently reserve case-insensitive official names, emails
and contractor numbers, including concurrent requests. Conflicts do not overwrite
accounts. This implements the requested unique-name rule: identical legal names
need a deliberately approved distinct official representation, not silent merging.

## Protected Identifiers

Every identity has an internal random UUID and a public `TN-` contractor number
with 128 random bits. Storage generates both. A database trigger prevents changing
the UUID, number or identity email through ordinary updates. Neither identifier is
a password or token; authentication and server-side rights remain mandatory.

New timesheets persist the server-resolved number and name. Existing owned records
can display approved identity by email once an admin assigns it; historical records
are not destructively merged or automatically renamed in stored evidence. Public
directories/messages use approved official names, with email fallback for legacy
accounts. Normal directory responses never include the internal UUID.

## Existing Accounts and Nicknames

Admins use **Correct an existing account's official name** to assign/correct names
without changing roles or identifiers. Microsoft names and self-edited profiles
are not automatically treated as approved official identity.

Personal profile names are now private nicknames, never company-facing names.
New saves reserve case-insensitive uniqueness while preserving chosen casing.
Nicknames permit 2-40 characters or empty to remove, excluding hidden controls.
Existing profile values are not retrospectively certified as unique/approved.

Self-registration and nickname substitution on personal-device timesheets remain
future work. Registration must retain pending approval and must not grant applicants
roles or rights. Company review screens, messages and audit evidence remain official.

## Storage and Tests

`POST /tanovo-time/api/people` handles onboarding/admin correction; GET returns only
the current account's official identity. Tables are `account_identities` and
`account_personal_names`; new timesheets store `contractor_number`.
Schema initialization is additive and lazy, not a reset or automatic legacy backfill.
API/unit tests cover normalization, duplicate responses, role/identifier injection
and explicit save. Live constraints/concurrency require a disposable staging test.
