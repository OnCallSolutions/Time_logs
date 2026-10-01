/**
 * Extends NextAuth session typing with the app's required user id field.
 *
 * The session callback copies the provider subject into session.user.id. This
 * declaration makes that field available to TypeScript wherever auth state is
 * read.
 */
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}
