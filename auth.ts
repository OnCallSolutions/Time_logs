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

async function writeAuthAudit(event:{actorEmail:string;action:"authentication_succeeded"|"authentication_failed"|"authentication_signed_out";targetType:string;metadata:Record<string,unknown>}):Promise<void>{
  try{const {recordAuditEvent}=await import("@/lib/db");await recordAuditEvent(event)}catch{console.error("[auth] Authentication audit event could not be recorded.")}
}

function safeAuthDiagnostic(value:unknown):string|undefined{
  return typeof value==="string"&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value)?value:undefined
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: false,
  logger: {
    /** Records safe error categories only; provider messages may contain sensitive data. */
    error(error) {
      const errorType=typeof error?.name==="string"?error.name.slice(0,80):"unknown"
      const cause=error&&typeof error==="object"?Reflect.get(error,"cause"):undefined
      const causeType=cause&&typeof cause==="object"?safeAuthDiagnostic(Reflect.get(cause,"name")):undefined
      const causeCode=cause&&typeof cause==="object"?safeAuthDiagnostic(Reflect.get(cause,"code")):undefined
      const providerError=cause&&typeof cause==="object"?safeAuthDiagnostic(Reflect.get(cause,"error")):undefined
      // Auth.js wraps OAuth failures more than once; inspect one nested cause,
      // but only publish identifier-shaped fields rather than provider messages.
      const nested=cause&&typeof cause==="object"?Reflect.get(cause,"err"):undefined
      const nestedCause=nested&&typeof nested==="object"?Reflect.get(nested,"cause"):undefined
      const nestedCauseType=nested&&typeof nested==="object"?safeAuthDiagnostic(Reflect.get(nested,"name")):undefined
      const nestedCauseCode=nested&&typeof nested==="object"?safeAuthDiagnostic(Reflect.get(nested,"code")):undefined
      const nestedProviderError=nestedCause&&typeof nestedCause==="object"?safeAuthDiagnostic(Reflect.get(nestedCause,"error")):undefined
      const status=cause&&typeof cause==="object"?Reflect.get(cause,"status"):undefined
      const diagnostics={errorType,causeType,causeCode,providerError,nestedCauseType,nestedCauseCode,nestedProviderError,status:typeof status==="number"?status:undefined}
      console.error("[auth] Authentication failed.",diagnostics)
      void writeAuthAudit({actorEmail:"system@tanovo-time.local",action:"authentication_failed",targetType:"authentication",metadata:{provider:"microsoft-entra-id",...diagnostics,outcome:"failed"}})
    },
  },
  trustHost: true,
  basePath: apiPath("/api/auth"),
  session:{strategy:"jwt",maxAge:SESSION_MAX_SECONDS},
  jwt:{maxAge:SESSION_MAX_SECONDS},
  events:{
    /** Records provider sign-ins without storing tokens or claims. */
    async signIn({user,account}) {
      if(user.email)await writeAuthAudit({actorEmail:normalizeEmail(user.email),action:"authentication_succeeded",targetType:"authentication",metadata:{provider:account?.provider??"unknown",outcome:"success"}})
    },
    /** @param event - Signed token supplied by Auth.js on logout. @returns Promise<void> after revoking that session. */
    async signOut(event){
      if("token" in event&&typeof event.token?.appSessionId==="string"){
        const email=typeof event.token.email==="string"?normalizeEmail(event.token.email):"system@tanovo-time.local"
        await writeAuthAudit({actorEmail:email,action:"authentication_signed_out",targetType:"authentication",metadata:{outcome:"signed_out"}})
        await revokeAppSession(event.token.appSessionId)
      }
    },
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
