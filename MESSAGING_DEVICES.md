# Messaging Devices and Browser Caching

## Encryption and Recovery

Messages continue to use the existing signed, end-to-end encrypted envelopes.
The server receives ciphertext, public identities, and an encrypted recovery
backup, never a recovery passphrase or unencrypted private key.

At first setup or recovery, **Remember encryption on this personal device** stores
nonextractable Web Crypto private-key handles in IndexedDB. The passphrase is not
stored. Subsequent visits restore matching keys only after the authenticated
key-directory request succeeds. Remembered fingerprints must match the server's
published identity; changes fail closed.

One-time setup/recovery is still required on a new device. Browser profiles,
ports, and deployment hostnames are separate origins and do not share trust.
Use a stable deployment hostname for consistent device access. Clearing browser
site data removes remembered keys. Lock messages deletes local trust and clears
plaintext memory, but does not reset the server identity or encrypted backup.

Do not remember keys on shared computers. Microsoft sign-out clears the session
and browser response cache but deliberately retains personal-device key handles
for the next matching login. Nonextractable keys are not hardware-backed security:
malicious same-origin code or a compromised browser can still invoke them.
This protocol is not the WhatsApp Signal protocol and does not claim equivalent
forward secrecy or independent security certification.

## Sending and Review Feedback

Compose defaults to an individual recipient. Every selected participant must
publish an encryption identity before sending. Missing setup is reported rather
than silently dropping recipients or sending plaintext. Send success is reported
only after server confirmation. Opening AI review shows progress, explicit empty
results, recommendations, or a service error; it never approves work by itself.

## Cache Boundaries

Response caching is account-scoped and memory-only, with a maximum of 30 seconds.
Profiles retain results for 15 seconds and recipient directories for 3 seconds.
Key directories refresh on participant changes, focus, and visible-tab timers.
Unchanged inbox responses retain their array identity. Unchanged verified message
envelopes reuse decrypted text in component memory only; edits/deletions invalidate
those entries. Background inbox polling pauses when the tab is hidden.

Profile saves invalidate profile reads. Sign-out clears response caches. Failed
responses are never cached. Permissions, mutations, and financial evidence retain
fresh server validation; no global server cache or localStorage plaintext cache
has been introduced. Verification uses mocks and real Web Crypto primitive tests;
authenticated deployment acceptance and independent crypto review remain needed.
