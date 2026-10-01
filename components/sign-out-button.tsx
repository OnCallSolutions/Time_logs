"use client"

/**
 * Provides a reusable sign-out button backed by a server action.
 *
 * The form submits directly to the server action so sign-out works without adding
 * client-side auth logic to pages that only need a simple control.
 */
import { LogOut } from "lucide-react"
import { signOutAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

/**
 * Renders the server-backed sign-out control.
 *
 * The button is intentionally small and reusable because it appears in both the
 * main app header and the access-denied screen.
 *
 * @returns A form button that signs out through the server action.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        <LogOut className="size-3.5" aria-hidden="true" />
        Sign out
      </Button>
    </form>
  )
}
