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
import { normalizeEmail } from "@/lib/identity-policy"
import {createAppSession,readAppSession,revokeAppSession} from "@/lib/app-sessions"
import {SESSION_MAX_SECONDS} from "@/lib/session-policy"

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
  session:{strategy:"jwt",maxAge:SESSION_MAX_SECONDS},
  jwt:{maxAge:SESSION_MAX_SECONDS},
  events:{
    /** @param event - Signed token supplied by Auth.js on logout. @returns Promise<void> after revoking that session. */
    async signOut(event){if("token" in event&&typeof event.token?.appSessionId==="string")await revokeAppSession(event.token.appSessionId)},
  },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  callbacks: {
    /**
     * Creates session state only on provider login and validates every later use.
     * @param params - Verified token/provider context; client update data is ignored.
     * @returns Promise containing a live token, or null when expired/revoked/legacy.
     */
    async jwt({token,account,user}){
      if(account&&user?.email)token.appSessionId=await createAppSession(normalizeEmail(user.email))
      if(typeof token.appSessionId!=="string"||typeof token.email!=="string")return null
      try{if(!await readAppSession(token.appSessionId,token.email))return null}catch{return null}
      return token
    },
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
        if(session.user.email)session.user.email=normalizeEmail(session.user.email)
      }
      session.appSessionId=typeof token.appSessionId==="string"?token.appSessionId:undefined

      return session
    },
  },
})
