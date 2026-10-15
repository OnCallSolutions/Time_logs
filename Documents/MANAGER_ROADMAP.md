# Manager Logic and UI

Business logic belongs on `manager`; shared presentation belongs on `user_Interface`.
Feature integration targets Development. Branch ownership never grants application
rights, and neither AI nor hidden UI controls replace server authorization.

## Current Safeguards

Managers submit personal time through their separate managerial-time lane. Another
authorized reviewer must approve or reject it. Reviewer privileges cannot edit or
delete their own submitted/approved evidence, reopen their own approved records,
or remove protected own records through bulk clearing. Submitted records may be
recalled into draft without rewriting evidence in the same request.

Selected approvals are explicitly confirmed and bounded to fifty loaded eligible
records. AI suggestions remain advisory. Approved contractor evidence is handed
to an active account manager only with admin-granted financial handoff rights.

## Recommended Next Logic

1. Explicit project/team assignments and coverage rules; current `view_team` is
   broad team visibility, not a defined manager-to-contractor reporting structure.
2. Submission timestamps, review-age indicators, and configurable escalation rules
   without assuming an undocumented approval SLA.
3. Revision-aware review and persisted AI advice tied to the exact submitted evidence.
4. Review notes, correction history, reviewer reassignment, and out-of-office coverage.
5. Paginated review/handoff queues and truthful batch outcomes with retry support.
6. Approved-work reconciliation, rates and currency policy, then separate financial
   authorization. No fund-release implementation until those rules are agreed.

## UI Direction

Keep contractors and managers primary. Present manager personal time separately
from operational review. Put selection, search, evidence and AI suggestions inside
the review workspace rather than repeating large tables on every landing view.
Preserve white/orange dominance with semantic feature accents and responsive windows.

No new Vercel secrets are required for these manager safeguards or UI changes.
Existing Microsoft, database and AI configuration remains unchanged.
