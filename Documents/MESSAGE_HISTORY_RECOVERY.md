# Message History and Recovery

## Everyday Experience

Authorized Microsoft sign-in automatically registers/restores browser keys. Users
enter no encryption password/recovery phrase. Device private keys stay nonextractable
in IndexedDB. Ordinary users see connection/retry status, not fingerprint controls.

Incoming orange bubbles sit left; confirmed outgoing green bubbles sit right. Width
is limited to 88% on narrow screens and 36rem on desktops, with long-string wrapping.
Failed/unconfirmed sends appear red with `!!`, retaining the draft only in memory.
Timeouts are not falsely presented as proof that the server rejected a message.

One grey tick means server accepted/awaiting delivery; two grey ticks mean fetched
by the recipient account but unread; two blue ticks mean explicitly opened/read.
Receipts describe accounts, not every device's connection. Broadcasts report counts.

## Trusted-Device Sync

Original ciphertext/signatures stay unchanged. A connected own device verifies the
message and rewraps its AES content key for another enrolled own device. The signed
transfer binds account, message ID, source signature and target fingerprint. The
server sees wrapped keys, not plaintext. Both transfer and original signatures are
verified before display. Edits/deletion invalidate prior transfers.

Background sync uses 50-message pages, up to 20 per cycle, resumes on later polls
and avoids repeated successful relays within the mounted session. A recovered
device can relay verified history onward. Older UI history is separately paginated.
An existing device must possess the key; offline-only history waits for that device
or administrator recovery. Automatic enrollment trusts Microsoft account sessions;
it does not include out-of-band device approval.

## Organization Recovery

Configure BOTH server-only variables to enable the optional fallback:

| Variable | Required Value |
| --- | --- |
| `MESSAGE_RECOVERY_ENCRYPTION_KEY` | RSA-3072 PKCS#8 private PEM |
| `MESSAGE_RECOVERY_SIGNING_KEY` | P-256 EC PKCS#8 private PEM |

Use the organization's approved key-generation and secret-management process. Never
use `NEXT_PUBLIC_*`, Git, chat or screenshots for these values. PEM newlines or
escaped newline sequences are accepted. Keep development and production keys
separate, scope Vercel variables correctly and redeploy. This change does not
generate, print or configure private key values.

Only public recovery identities are published. For enrolled participants, new
messages include a recovery envelope; trusted devices can relay older keys too.
An admin opens **Organization history recovery**, checks an account's enrolled
devices, selects a target and explicitly confirms each page. Intent/completion
are audited. The server rewraps content keys without returning message plaintext.

**Trust boundary:** the organization holds recovery keys and can technically recover
message content. This is organization-recoverable encryption, not a claim that the
organization cannot decrypt. Leave both variables unset for trusted-device-only
mode. Invalid/incomplete configuration fails closed. Recovery cannot recreate keys
that were never wrapped/relayed and no surviving trusted device possesses.

Back up keys securely. Do not replace them without a planned key-ring/rotation
migration; automatic historic-key rotation is not implemented. Managed KMS/HSM
storage and administrator step-up authentication are recommended production hardening.

## Storage and Verification

`app_message_history_shares` stores signed wrapped keys. The history API is
`/tanovo-time/api/messages/history`; recovery is admin-only at
`/tanovo-time/api/messages/recovery`. Recovery only targets enrolled devices of the
selected account. Retention/deletion still governs whether original content exists.

Tests use real ephemeral RSA/AES/ECDSA for transfers, tampering, wrong accounts,
revisions and organization recovery. API tests cover enrollment/admin guards;
component tests cover explicit saves and receipt colors. Browser layout checks use
synthetic accounts/APIs, not an authentication bypass. Live PostgreSQL concurrency
and authenticated multi-device operation still need staging verification.
