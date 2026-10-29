# Tanovo Time

Tanovo Time helps organizations collect, review, and manage contractor and employee timesheets. It brings time entry, approvals, account administration, messaging, and operational reporting into one workspace.

## Current Status

Development is the active integration and testing branch. The application includes role-based workspaces, timesheet entry and review, configurable reporting periods, project assignments, messaging, access administration, audit reporting, and AI-assisted workflows.

AI is advisory and confirmation-based: it can prepare recommendations and proposed actions, while people remain responsible for reviewing and confirming changes. The assistant is currently being investigated because requests in the Development preview have returned errors. AI gateway choice and production readiness are under review; do not treat the assistant as available until the live workflow has been verified.

The application is intended for one organization at a time today. Licensed multi-company SaaS operation, payment execution, and broader external integrations are future work and require separate design and security review.

## Roles

- **Contractors** record and submit their own work, and can request help from their organization.
- **Employees** record and submit work under company policy.
- **Managers** review assigned work, support their teams, and use authorized administrative tools.
- **Account managers** review assigned business-account information within their granted access.
- **Administrators** manage organizational access and oversight.

Access is governed by role and granted permissions. Sensitive or consequential operations require an authorized person to confirm them.

## Product Principles

- Keep timesheets and approvals understandable and traceable.
- Limit people to the records and controls they are authorized to use.
- Preserve an audit trail for important administrative and workflow activity.
- Use AI to assist with preparation and analysis, not to make unreviewed decisions.
- Verify security, privacy, and operational readiness before expanding to additional organizations or integrations.

## Near-Term Work

- Diagnose and restore reliable AI assistant requests in the Development environment.
- Select an AI gateway and model approach with engineering and management review.
- Continue improving timesheet workflows, reporting, and administrative oversight.
- Plan tenant isolation, onboarding, licensing, and operations before multi-company launch.

For engineering setup, release procedures, and detailed workflow documentation, consult the project’s internal documentation and deployment settings. This overview intentionally avoids environment-specific instructions and implementation details.
