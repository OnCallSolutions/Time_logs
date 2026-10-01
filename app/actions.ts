"use server"

/**
 * Provides server actions shared by client components.
 *
 * Server actions live here so client components can trigger authenticated
 * mutations without importing server-only auth helpers directly.
 */
import { signOut } from "@/auth"

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
  await signOut()
}
