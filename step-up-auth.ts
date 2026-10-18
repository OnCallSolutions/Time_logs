/** Isolated Auth.js configuration for short-lived, high-impact-action verification. */
import "server-only"
import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import { apiPath } from "@/lib/paths"

export const stepUpSessionCookieName="tanovo-time.stepup.session-token"
const secure=process.env.NODE_ENV==="production"
const cookieOptions={httpOnly:true,sameSite:"lax" as const,path:"/",secure}

export const {handlers:stepUpHandlers,auth:stepUpAuth}=NextAuth({
  trustHost:true,
  basePath:apiPath("/api/auth"),
  secret:process.env.AUTH_SECRET,
  logger:{
    error(error){
      const errorType=typeof error?.name==="string"?error.name.slice(0,80):"unknown"
      console.error("[step-up-auth] Microsoft verification failed",errorType)
    },
  },
  session:{strategy:"jwt",maxAge:5*60},
  jwt:{maxAge:5*60},
  cookies:{
    sessionToken:{name:stepUpSessionCookieName,options:cookieOptions},
    callbackUrl:{name:"tanovo-time.stepup.callback-url",options:cookieOptions},
    csrfToken:{name:"tanovo-time.stepup.csrf-token",options:cookieOptions},
    pkceCodeVerifier:{name:"tanovo-time.stepup.pkce-code-verifier",options:cookieOptions},
    state:{name:"tanovo-time.stepup.state",options:cookieOptions},
    nonce:{name:"tanovo-time.stepup.nonce",options:cookieOptions},
  },
  providers:[MicrosoftEntraID({
    clientId:process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    clientSecret:process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    issuer:process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  })],
  callbacks:{
    async jwt({token,account,user}){
      if(account?.provider==="microsoft-entra-id"&&user?.email)token.stepUpAuthenticatedAt=Date.now()
      return token
    },
    session({session,token}){
      return Object.assign(session,{stepUpAuthenticatedAt:typeof token.stepUpAuthenticatedAt==="number"?token.stepUpAuthenticatedAt:null})
    },
  },
})
