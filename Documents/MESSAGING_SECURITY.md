# Messaging and Encryption

## Automatic Device Identity

Normal messaging has no encryption password, recovery phrase, or unlock form.
After Microsoft sign-in, every actor automatically connects a remembered device
or creates one. Browser IndexedDB stores nonextractable RSA-OAEP 3072-bit and
ECDSA P-256 private keys. Only public identities are enrolled with the server.
Up to five device identities per account are supported.

Version 2 messages use a fresh AES-256-GCM content key, wrapped separately for
each enrolled device of every recipient and sender. Signatures bind ciphertext,
author, conversation metadata, and device envelopes. The API validates signatures
and the authorized participant/device set. Missing keys cause explicit failure,
never plaintext fallback or silent recipient exclusion.

Recipients must sign in once to enroll. New devices receive future messages, not
automatic access to old history. Profiles, hosts, and ports have separate browser
storage. Clearing site data can lose historical access. Microsoft sign-out ends
the session but retains device keys for the next matching sign-in.

Legacy encrypted identities and matching remembered keys remain supported.
Encrypted-backup compatibility code is not the normal setup or a promise of
automatic history recovery. Existing plaintext is not retroactively encrypted.
See [device behavior](MESSAGING_DEVICES.md).

## Controls and Receipts

Managers/admins need sending rights. Audiences include individuals, everyone,
workforce, contractors, employees, managers, and admins. Encrypted membership
is fixed at send time; later accounts do not acquire historical content keys.

Senders may edit within one hour. Scoped admin moderation is exempt from that
deadline but does not decrypt unrelated conversations. Edits remain encrypted
and signed. Confirmed deletion cannot erase screenshots, recipient copies, or backups.

| State | Meaning |
| --- | --- |
| Sent | Server accepted the message |
| Delivered | Authorized recipient inbox fetched it |
| Read | Recipient opened successfully decrypted content in a visible tab |
| Group counts | Per-recipient state, not a claim everyone read |

The latest 100 messages form the inbox. The top-right chat icon displays unread
counts including zero. Visible-page polling runs every ten seconds and on focus.
Notifications/sound are optional, not closed-app push; audio requires interaction.

## Cache and Trust Limits

Short-lived response caches are account-scoped and memory-only. Permission
decisions and mutations remain fresh. Decrypted content is cached only in mounted
component memory and invalidated by changed envelopes, deletion, or identity loss.

The server sees participants, timing, ciphertext sizes, receipts, and audit metadata.
Never log plaintext/private keys or send private message content to AI.

This custom protocol is not Signal/WhatsApp, has not been independently audited,
and does not provide forward secrecy, a double ratchet, or a cryptographic
anti-replay transcript. Enrollment/first-use discovery trust the authenticated
server directory. Fingerprint pinning does not eliminate initial-directory risk.

Nonextractable keys are not hardware-backed security: XSS, a compromised browser,
or malicious same-origin code can invoke them. Admins have no universal decryption
key. Retained identities require appropriate personal/managed-device controls.
Obtain independent protocol and deployment review before production security claims.

## Storage and Verification

`app_messages`, `app_message_receipts`, `app_message_devices`, and legacy
`app_message_keys` store encrypted content and public/lifecycle metadata.
Normal enrollment does not upload private keys or require a Vercel encryption secret.

Run `pnpm verify`. Tests cover actual Web Crypto, tampering, device isolation,
public-only enrollment, automatic connection, legacy compatibility, rights,
deadlines, and receipts. Mocked persistence does not certify live database
concurrency or authenticated cross-device acceptance; validate those separately.
