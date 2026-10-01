/**
 * Configures NextAuth with Microsoft Entra ID and exports auth helpers.
 *
 * The configuration pins the app's auth routes under /timelog/api/auth so they
 * match the Next.js base path and Azure redirect URI. Exported helpers are reused
 * by pages, API routes, and server actions.
 */
import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  basePath: "/timelog/api/auth",
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
