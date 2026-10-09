# Branch Responsibilities

- `employee`: personal employee workflow controls and AI-assisted draft review.
- `manager`: team review, advisory AI recommendations, and explicit approval/rejection dialogs.
- `admin`: technology management, access administration, and security-report navigation.

`Development` is the shared source of truth for integrated work. Create future feature branches from its latest commit and open feature pull requests targeting `Development`. After review and testing, release changes through a pull request from `Development` to `main`. Keep feature branches after integration; do not merge feature branches directly into `main`.

- `audit_logging`: audit capture, white admin activity views, and event details. IP addresses appear only in selected event details.
- `security`: builds on the admin branch; advisory AI assessments and future server-side cybersecurity controls. Assessments never automatically grant, revoke, or block access.
- `Per_user_entries` was retired after its commits were preserved in the three role branches. New feature work belongs in `employee`, `manager`, or `admin`.
- `user_Interface`: shared appearance and responsive layout.
- `testing`: external testing tools and automation, including the richer live table and test explanations.
- `messages`: messaging logic and chat controls; merged into remote Development at `8463b58` and retained.
- `database_management`: local, unmerged database reliability and AI-readiness groundwork.
- `main`: reviewed releases.
- `Development`: integrated UI, employee workflows, administration, security monitoring, and testing tools.

Use the relevant active feature branch for new work, then integrate into
`Development`. Role changes do not require a separate branch per runtime role.
Contractor, employee, manager, account manager, and admin are authorization roles,
not deployment environments. Development and branches created from its rebranded
code use `/tanovo-time`; unchanged older branches retain their own routes.
The historical remote rebrand branch is now `rebrand`; PR #5 is closed as
superseded. Its older implementation does not replace Development functionality.

# Storage and Configuration

`audit_events` stores actor, action, target, timestamp, request IP, user agent, and sanitized metadata. `security_reports` stores daily monitoring status, severity and findings as JSONB, model, event count, truncation flag, and timestamps. Table creation follows the existing Neon schema initialization pattern.

AI monitoring runs daily at 06:00 UTC on Vercel production deployments, using CRON_SECRET to authenticate. It examines up to 250 recorded events from the past 24 hours. It does not observe every request, detect malware, or establish that an account was compromised. Network identifiers are pseudonymized before model input; actor email addresses are still sent to the configured AI service. The admin Security risks button reads stored reports without starting analysis. Set CRON_SECRET and AI Gateway credentials before deployment; preview/local monitoring requires invoking the scheduled endpoint with the bearer secret.

Employee roles and access decisions belong in `managed_user_access`, not Vercel environment variables. Adding an active employee through admin management takes effect through database-backed authorization without a redeploy. Microsoft tenant membership and application access remain separate requirements.

Deployment secrets such as `DATABASE_URL`, `AUTH_SECRET`, Microsoft credentials, and AI Gateway credentials are deployment configuration. Vercel supports CLI/API automation and branch-specific preview variables; never expose a Vercel management token to the client or give employee creation permission to modify deployment secrets.
