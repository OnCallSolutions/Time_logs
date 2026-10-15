# Agreed Team Assignment Model

The user approved multiple teams per contractor, with a primary manager and
additional authorized reviewers for each team. This document defines the next
milestone; team-based visibility is not implemented by the lifecycle feature.

## Relationships

- Teams have an identity, name, active state, and primary operational manager.
- Contractors and internal staff can belong to multiple teams.
- Additional reviewers have explicit assignments, not inferred authority from titles.
- Project scope must bind each work record to its intended team/project; membership
  alone must not expose unrelated work when a contractor serves multiple teams.
- Managers' own records still need an independent reviewer with the correct scope.

## Enforcement Before UI Rollout

Assigned scopes must constrain list, item, review, AI input, report, bulk operation,
and account-handoff queries. A selector or hidden button is not an access boundary.
An admin-controlled cross-team right should be separate from ordinary manager
visibility. Existing broad `view_team` behavior must not be called team isolation.

Temporary coverage should inherit an explicitly assigned team/project scope, not
silently expand it to whole-application access. Existing whole-application temporary
grants require a reviewed migration when team boundaries become authoritative.

## Follow-On Milestones

Store submission and review timestamps for real age/escalation rules. Persist AI
advice against an evidence revision and invalidate it on source changes. Provide
explicit reviewer reassignment, coverage intervals, cursor pagination, and financial
reconciliation without changing historical approval evidence.

Lifecycle dates do not automatically transfer team ownership or pending work yet.
That remains a manual offboarding step until this scope-aware workflow is built.
