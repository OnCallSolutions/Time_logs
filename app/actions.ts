"use server"

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

function isAuthCookie(name: string) {
  return (
    authCookieNames.includes(name) ||
    name.startsWith("authjs.session-token.") ||
    name.startsWith("__Secure-authjs.session-token.") ||
    name.startsWith("next-auth.session-token.") ||
    name.startsWith("__Secure-next-auth.session-token.")
  )
}

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

export async function signOutAction() {
  await signOut({ redirect: false })
  await clearAuthCookies()
  redirect("/")
}
