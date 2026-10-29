# Messaging actions and business policies

## Current behavior

- Search conversations and filter the inbox to one official sender.
- Review messages in chronological threads with day separators; inbox conversations are grouped by recent activity.
- Edit an eligible message during the one-hour sender window. Administrators retain moderation override.
- Delete for me hides the message only from the authenticated account's inbox, across its devices.
- Delete for everyone replaces the content with a tombstone for every participant. A sender can do this for one hour; administrators retain moderation override.
- Read and delivery receipts remain attached to the original message. Deletion actions are audited without copying message content into the audit log.
- Message bodies remain end-to-end encrypted. Server-side moderation can remove ciphertext but cannot inspect it.

## Action catalog to design

| Action | Business behavior to settle | Security and audit boundary |
| --- | --- | --- |
| Reply / quote | Preserve a small, permission-scoped excerpt; announcements may be non-replyable. | Quote only content the sender can currently decrypt; never include plaintext in audit records. |
| Forward | Allow individual or approved groups; show the original sender and date. | Re-encrypt for every new recipient; do not forward removed, expired, or unauthorized content. |
| Copy | Copy only decrypted text explicitly selected by the user. | Never copy ciphertext as if it were readable text. |
| Reactions | Restrict to a short standard set; allow removal and show actor/time. | Persist reaction actor IDs, not emails in the UI; audit policy changes, not every emoji. |
| Star / save | Personal saved list, private to the account, with optional reminders. | Do not expose a user's saved list to managers or administrators by default. |
| Pin | Personal pins by default; organization-wide pins only for authorized announcement owners. | Organization pins need an owner, expiry, and an audit event. |
| Mark unread | Personal inbox state, separate from delivery/read receipts. | Changing one's unread marker must not falsify another recipient's read receipt. |
| Archive / mute | Personal conversation preference, optionally with expiry for mute. | Never delete or suppress required compliance or high-priority notices. |
| Search | Search sender, date, and locally available decrypted content. | Keep plaintext search indexes on-device unless an explicit organizational policy changes the encryption model. |
| Report / moderation | Report a message or participant to a designated admin reviewer. | E2EE means reports must explicitly attach the selected content; capture reporter, reason, and handling status. |
| Group conversations | Named membership, roles, join/leave events, and controlled announcements. | Every membership change rotates or reissues access keys; old members must not receive future keys. |

## Recommended business defaults

1. Keep delete-for-me available to every participant. It affects only that account's view and must not imply that the organization has erased its audit evidence.
2. Permit sender edits and unsend for one hour. After that, preserve the message and use a correction/retraction message. Admin moderation remains a separate audited action.
3. Keep read receipts visible only to conversation participants. Do not use them as timesheet or performance evidence.
4. Treat announcements as distinct from one-to-one messages. Require a clear audience, official sender name, priority, and sent time; email delivery will need a separate consent and retry policy.
5. Keep destructive or broad actions behind a confirmation step, show the affected recipients/count, and use server-side authorization and idempotency for every mutation.
6. AI may summarize, find, or propose a reply/action from content the user explicitly shares with it. It must never silently send, delete, forward, report, or change membership; require confirmation and recheck current rights at execution.

## Delivery plan

1. Finish and deploy the scoped delete, search, sender filter, and date-grouping foundation.
2. Add personal unread, archive, and mute state in account-scoped storage.
3. Add reply/quote, copy, forward, reactions, and saved messages, each with focused permission, encryption, audit, and multi-device tests.
4. Add organization group conversations and announcement/email workflows only after membership/key rotation and retention policies are implemented.
5. Add admin reporting/moderation workflows with explicit user-submitted evidence and retention boundaries compatible with end-to-end encryption.
