# Messaging And Encryption

## Message Lifecycle

Managers with `send_messages` and administrators retain the existing employee/private and broadcast controls. Employees retain inbox access; this change does not grant additional sending or administrative rights.

Senders can edit for one hour from the original creation time. Database-side checks enforce the deadline atomically. Admins are exempt from that deadline only for messages they can already access. End-to-end encryption does not give an admin a universal decryption key: admins outside a private conversation cannot read or edit it.

Deletion requires confirmation and replaces content and ciphertext with a deletion marker. This cannot erase screenshots, previous recipient copies, database backups, or prior legacy plaintext. Audit events store actor/action/target and request context, not message bodies, passphrases, or private keys.

- **Sent:** the server accepted the message.
- **Delivered:** an authorized recipient inbox fetched it; this does not imply reading or decryption.
- **Read:** the recipient explicitly opened it in a visible tab after successful decryption. Legacy plaintext messages are acknowledged when opened.
- Broadcasts show delivered/read counts rather than pretending that every employee has read them.
- The inbox displays the latest 100 messages; unread badges cover that current inbox, not unlimited historical messages.
- Inbox/focus polling runs every ten seconds while the application is open. These are in-app alerts, not push notifications when the app is closed.
- Sound is opt-in and requires a browser user gesture each session. Alerts omit message content; preferences are stored per account.

## Browser Keys And Recovery

Every participant sets up messaging encryption using a separate recovery passphrase of at least 16 characters. This is not a Microsoft password. Use a strong unique passphrase, stored in a password manager.

The browser generates a 3072-bit RSA-OAEP/SHA-256 encryption identity and an ECDSA P-256 signing identity. New messages use a fresh AES-256-GCM content key and 96-bit random nonce. Content keys are wrapped separately for each participant; signed context binds author, sender, private/broadcast recipient, and a random message token. Keys are authenticated against the exact authorized recipient set at the API boundary.

The browser encrypts a private-key backup with AES-GCM using a PBKDF2/SHA-256-derived passphrase key (600,000 iterations, random 128-bit salt). Account email is authenticated backup context. Only the encrypted backup and public identities are transmitted. Recovery verifies that the recovered private keys match the published public identity. Unlocked private keys are nonextractable and held only in component memory; locking or leaving the message workspace clears them and decrypted text.

On another device, sign in with Microsoft and unlock using the same recovery passphrase. Forgetting it means losing access; no administrator reset can recover the old plaintext. Key rotation, recovery-passphrase changes, and device revocation are not yet implemented. Public identities cannot be silently replaced through the registration endpoint.

Every broadcast recipient must have an identity at send time, up to 100 participants including the sender. New employees cannot decrypt earlier encrypted broadcasts. Edits preserve the original participant set.

## Trust And Limitations

Existing plaintext records remain clearly labeled **Legacy plaintext message**. They are not retroactively end-to-end encrypted; separate migration and backup-retention decisions are required. New sends fail closed without encrypted payloads or participant keys.

Public fingerprints are pinned in each browser and available for comparison through another trusted channel. First use and a new device still rely on the server's key directory until participants compare fingerprints. A malicious directory can attack initial key discovery. The custom integration is not the Signal/WhatsApp protocol and does not provide forward secrecy or a double ratchet.

The server still sees participant identities, timestamps, ciphertext size, receipt counts, and audit metadata. A compromised browser, XSS, malicious same-origin application code, or stolen recovery passphrase can expose messages. Database backups retain encrypted private keys and are susceptible to offline passphrase guessing; passphrase strength matters.

Receipts, timestamps, and message ordering remain server-asserted. This version does not implement a cryptographic anti-replay/anti-rollback transcript, so signed content authentication should not be confused with protection against a malicious server replaying previously valid messages.

This implementation is a development feature, not an independently audited cryptographic product. Obtain an independent security review of the protocol, deployment, CSP/XSS defenses, key discovery, and recovery before production use. Test HTTPS deployments and recovery across devices with disposable accounts first.

## Storage And Verification

Idempotent schema initialization extends `app_messages` with `edited_at`, `deleted_at`, and `encrypted_payload`; creates `app_message_receipts` for per-recipient lifecycle state; and creates `app_message_keys` for public identities and encrypted backups. It is cached per server process and retried after initialization failure. No Vercel secret is needed for client-side encryption.

Run `pnpm verify`. Crypto tests use actual Web Crypto operations and verify server/browser signature interoperability, wrong-passphrase rejection, tampering, recipient isolation, and recovery. API tests check identity scope, revoked rights, deadlines, plaintext downgrade prevention, and immutable key registration. UI tests check explicit Save/Delete confirmation and opened-message receipts. Tests do not use a live production database.

Cryptographic primitives are supplied by the platform's [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/), not handwritten cipher implementations.

The PBKDF2 work factor follows the SHA-256 baseline in [OWASP password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Authenticated encryption guidance is covered by [OWASP cryptographic storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html). These choices do not establish FIPS compliance or constitute an audit of this message protocol.
