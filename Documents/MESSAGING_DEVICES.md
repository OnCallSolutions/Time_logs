# Automatic Encrypted Messaging

Normal messaging has no encryption password, recovery form, or unlock action.
After Microsoft sign-in, the application generates nonextractable device keys,
stores them in browser IndexedDB, and registers public keys automatically. This
runs for all signed-in actors, even before they open the messaging window.

Version 2 messages encrypt one content key separately for every enrolled device
of each selected recipient. Signatures bind the recipient device envelopes as
well as the ciphertext and conversation metadata. Private keys and message text
are never sent to the server. Up to five device identities per account are stored
in `app_message_devices`; existing legacy identities are preserved separately.

Recipients need to sign in at least once to publish a device key. A selected group
cannot be silently reduced when a recipient has no device. Connection failures
remain visible, and no plaintext fallback is permitted.

Browser profiles, ports, and hostnames have separate storage. New devices receive
future messages but do not automatically recover past history. Existing legacy
ciphertext and matching remembered keys remain supported; keys are never reset
to disguise an inability to decrypt. Clearing site data can make past history
unavailable. Microsoft sign-out ends the session but does not erase device keys.

This design trusts authenticated device enrollment and the server's public-key
directory. It does not provide the Signal protocol, hardware-backed keys, or
independent security certification. Same-origin malicious code or a compromised
browser can invoke nonextractable keys. A security review is required before
claiming resistance to an actively malicious directory or account takeover.

## Cache and Verification

Public directory and profile reads use short-lived, account-scoped memory caches.
Permission checks and mutations remain fresh. Plaintext is cached only in mounted
component memory and invalidated by envelope changes, deletions, or loss of keys.
Background inbox polling pauses while the page is hidden.

Tests cover real Web Crypto, recipient/device isolation, envelope tampering,
public-only enrollment, automatic connection, and absence of recovery controls.
Live browser/database acceptance and external security review remain separate.
