/**
 * Renders the app entry page and gates access through Microsoft authentication.
 *
 * This server component is the first authorization boundary for the UI. It shows
 * a Microsoft sign-in screen for anonymous visitors, an allowlist warning for
 * authenticated but unapproved users, and the role-aware app shell for approved
 * users.
 */
import { signIn, auth } from "@/auth"
import { AuthScreen } from "@/components/auth-screen"
import { TimesheetApp } from "@/components/timesheet-app"
import { getEffectiveUserRole } from "@/lib/access"

/**
 * Renders the authenticated timesheet app or the Microsoft sign-in screen.
 *
 * Authentication state is read on the server so the initial render never exposes
 * the timesheet workspace to unauthenticated users. The resolved role is passed
 * down to the client app for navigation and display decisions.
 *
 * @returns The appropriate page for the current auth and allowlist state.
 */
export default async function Page() {
  const session = await auth()

  if (!session?.user) {
    /**
     * Starts the existing Microsoft flow with explicit account reauthentication.
     * @returns Promise<void> until Auth.js redirects to Microsoft.
     */
    async function microsoftSignIn(): Promise<void> {
      "use server"
      await signIn("microsoft-entra-id",undefined,{max_age:"0",prompt:"login"})
    }
    return <AuthScreen action={microsoftSignIn} />
  }

  const role = await getEffectiveUserRole(session.user.email)

  if (!role) {
    return <AuthScreen email={session.user.email ?? "Microsoft account"} />
  }

  return (
    <TimesheetApp
      role={role ?? "contractor"}
      userName={session.user.name}
      userEmail={session.user.email}
    />
  )
}
