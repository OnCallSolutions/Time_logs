# Branch Responsibilities

- `audit_logging_security`: employee administration, audit capture, white admin activity views, and event details. IP addresses appear only in selected event details.
- `security`: builds on the admin branch; advisory AI assessments and future server-side cybersecurity controls. Assessments never automatically grant, revoke, or block access.
- `Per_user_entries`: employee time-entry ownership and business workflows.
- `ui_widescreen_layout`: shared appearance and responsive layout.
- `testing_framework`: external testing tools and automation.
- `main`: reviewed releases.

Apply individual shared commits to branches that need them. Keep security-specific controls and assessment storage in `security` until reviewed for release.

# Storage and Configuration

`audit_events` stores actor, action, target, timestamp, request IP, user agent, and sanitized metadata. `security_reports` stores daily monitoring status, severity and findings as JSONB, model, event count, truncation flag, and timestamps. Table creation follows the existing Neon schema initialization pattern.

AI monitoring runs daily at 06:00 UTC on Vercel production deployments, using CRON_SECRET to authenticate. It examines up to 250 recorded events from the past 24 hours. It does not observe every request, detect malware, or establish that an account was compromised. Network identifiers are pseudonymized before model input; actor email addresses are still sent to the configured AI service. The admin Security risks button reads stored reports without starting analysis. Set CRON_SECRET and AI Gateway credentials before deployment; preview/local monitoring requires invoking the scheduled endpoint with the bearer secret.

Employee roles and access decisions belong in `managed_user_access`, not Vercel environment variables. Adding an active employee through admin management takes effect through database-backed authorization without a redeploy. Microsoft tenant membership and application access remain separate requirements.

Deployment secrets such as `DATABASE_URL`, `AUTH_SECRET`, Microsoft credentials, and AI Gateway credentials are deployment configuration. Vercel supports CLI/API automation and branch-specific preview variables; never expose a Vercel management token to the client or give employee creation permission to modify deployment secrets.
