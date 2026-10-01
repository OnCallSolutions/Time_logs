/**
 * Exposes the NextAuth route handlers under the app's configured base path.
 *
 * NextAuth owns the GET and POST behavior for sign-in, callback, session, and
 * sign-out requests. Re-exporting the configured handlers keeps the route file
 * thin while preserving the /timelog/api/auth path expected by Azure.
 */
import { handlers } from "@/auth"

export const { GET, POST } = handlers
