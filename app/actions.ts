"use server"

/**
 * Provides server actions shared by client components.
 *
 * Server actions live here so client components can trigger authenticated
 * mutations without importing server-only auth helpers directly.
 */
import { signOut } from "@/auth"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

const authCookieNames = [
  "authjs.session-token",
  "authjs.callback-url",
  "authjs.csrf-token",
  "authjs.pkce.code_verifier",
  "authjs.state",
  "authjs.nonce",
  "authjs.challenge",
  "__Secure-authjs.session-token",
  "__Secure-authjs.callback-url",
  "__Secure-authjs.pkce.code_verifier",
  "__Secure-authjs.state",
  "__Secure-authjs.nonce",
  "__Secure-authjs.challenge",
  "__Host-authjs.csrf-token",
  "next-auth.session-token",
  "next-auth.callback-url",
  "next-auth.csrf-token",
  "__Secure-next-auth.session-token",
  "__Secure-next-auth.callback-url",
  "__Host-next-auth.csrf-token",
]

/**
 * Checks whether a cookie name belongs to Auth.js or legacy NextAuth state.
 *
 * Sign-out needs to clear fixed cookie names plus chunked session cookies. This
 * helper centralizes that matching so the deletion loop can include both known
 * names and any chunked names currently present in the browser.
 *
 * @param name - Cookie name from the current request.
 * @returns True when the cookie should be expired during sign-out.
 */
function isAuthCookie(name: string) {
  return (
    authCookieNames.includes(name) ||
    name.startsWith("authjs.session-token.") ||
    name.startsWith("__Secure-authjs.session-token.") ||
    name.startsWith("next-auth.session-token.") ||
    name.startsWith("__Secure-next-auth.session-token.")
  )
}

/**
 * Builds an expired cookie payload for a specific path.
 *
 * Auth cookies can be scoped to either the domain root or the app base path. The
 * returned object preserves secure-cookie requirements for prefixed cookie names
 * while setting maxAge=0 so the browser removes the cookie.
 *
 * @param name - Cookie name to expire.
 * @param path - Path scope where the cookie should be expired.
 * @returns Cookie options that remove the target cookie.
 */
function expireCookie(name: string, path: string) {
  const secure = name.startsWith("__Secure-") || name.startsWith("__Host-")

  return {
    name,
    value: "",
    maxAge: 0,
    path,
    secure,
    httpOnly: true,
    sameSite: "lax" as const,
  }
}

/**
 * Expires Auth.js and NextAuth cookies on both root and /timelog paths.
 *
 * This is intentionally more aggressive than a default sign-out because preview
 * and local testing can leave cookies on different paths after base-path changes.
 * Clearing both paths prevents stale sessions from silently reauthenticating.
 *
 * @returns A promise that resolves once all matching cookies are expired.
 */
async function clearAuthCookies() {
  const cookieStore = await cookies()
  const names = new Set([
    ...authCookieNames,
    ...cookieStore.getAll().map(({ name }) => name).filter(isAuthCookie),
  ])

  for (const name of names) {
    cookieStore.set(expireCookie(name, "/"))

    if (!name.startsWith("__Host-")) {
      cookieStore.set(expireCookie(name, "/timelog"))
    }
  }
}

/**
 * Signs out the current user through the configured NextAuth provider.
 *
 * The action is used by form submissions in client components. NextAuth handles
 * clearing the session cookies and redirect behavior for the configured auth
 * base path.
 *
 * @returns A promise that resolves after the sign-out flow is started.
 */
export async function signOutAction() {
  await signOut({ redirect: false })
  await clearAuthCookies()
  redirect("/")
}
