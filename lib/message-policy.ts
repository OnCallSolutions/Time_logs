/**
 * Defines shared message lifecycle fields and the sender editing deadline.
 * The server independently enforces this policy using database timestamps.
 * Delivery means an inbox fetched the message; read means a recipient opened it.
 */
export const MESSAGE_EDIT_MINUTES = 60
export type AppMessage = {
  id: string; sender_email: string; recipient_email: string | null; body: string;
  created_at: string; edited_at?: string | null; deleted_at?: string | null;
  delivered_at?: string | null; read_at?: string | null;
  delivered_count?: number; read_count?: number;
  encrypted_payload?: import("@/lib/message-crypto").EncryptedMessage | null;
}

/**
 * Determines whether the current account may attempt editing a visible message.
 * @param message - Stored message with its original creation timestamp.
 * @param email - Signed-in account identity.
 * @param admin - Whether the current role is administrator.
 * @param now - Current epoch milliseconds, injectable for deadline tests.
 * @returns boolean indicating whether the client should show Edit.
 */
export function canEditMessage(message: AppMessage, email: string, admin: boolean, now = Date.now()): boolean {
  return !message.deleted_at && (admin || (message.sender_email.toLowerCase() === email.toLowerCase()
    && now < new Date(message.created_at).getTime() + MESSAGE_EDIT_MINUTES * 60_000))
}
