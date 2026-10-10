/**
 * Configures NextAuth with Microsoft Entra ID and exports auth helpers.
 *
 * The configuration pins the app's auth routes under /tanovo-time/api/auth so they
 * match the public Next.js base path and Azure redirect URI. The route handler
 * wrapper re-adds that public base path before requests reach Auth.js locally.
 */
import "server-only"
import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import { apiPath } from "@/lib/paths"

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: false,
  logger: {
    /**
     * Records authentication failures without provider payloads or credentials.
     * @returns void after a fixed diagnostic message is written.
     */
    error() {
      console.error("[auth] Authentication failed; verify server configuration.")
    },
  },
  trustHost: true,
  basePath: apiPath("/api/auth"),
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  callbacks: {
    /**
     * Copies the authenticated provider subject onto the session user object.
     *
     * NextAuth keeps the provider subject on the token by default. The app adds it
     * to session.user.id so client and server components can rely on a stable user
     * identifier alongside the Microsoft profile fields.
     *
     * @param params - NextAuth session callback parameters.
     * @param params.session - Session object that will be returned to the app.
     * @param params.token - JWT token containing the provider subject.
     * @returns The session with a stable user id populated when available.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ""
      }

      return session
    },
  },
})
