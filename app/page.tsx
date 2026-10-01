/**
 * Renders the app entry page and gates access through Microsoft authentication.
 *
 * This server component is the first authorization boundary for the UI. It shows
 * a Microsoft sign-in screen for anonymous visitors, an allowlist warning for
 * authenticated but unapproved users, and the role-aware app shell for approved
 * users.
 */
import { Clock3, LogIn } from "lucide-react"
import { signIn, auth } from "@/auth"
import { Button } from "@/components/ui/button"
import { SignOutButton } from "@/components/sign-out-button"
import { TimesheetApp } from "@/components/timesheet-app"
import { getEffectiveUserRole, isAllowedEmail } from "@/lib/access"

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
    return (
      <main className="mx-auto flex min-h-svh max-w-4xl flex-col justify-center gap-6 px-4 py-8 md:py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Timesheet
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Sign in to manage contractor hours
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground text-pretty">
            Use your Microsoft account to save and view your own time entries.
          </p>
          <form
            className="mt-5"
            action={async () => {
              "use server"
              await signIn("microsoft-entra-id")
            }}
          >
            <Button type="submit" size="lg">
              <LogIn className="size-4" aria-hidden="true" />
              Sign in with Microsoft
            </Button>
          </form>
        </section>
      </main>
    )
  }

  if (!isAllowedEmail(session.user.email)) {
    return (
      <main className="mx-auto flex min-h-svh max-w-4xl flex-col justify-center gap-6 px-4 py-8 md:py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Timesheet
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Access not approved
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground text-pretty">
            {session.user.email} is signed in with Microsoft, but this account is
            not on the approved access list for this app.
          </p>
          <div className="mt-5">
            <SignOutButton />
          </div>
        </section>
      </main>
    )
  }

  return (
    <TimesheetApp
      role={getEffectiveUserRole(session.user.email) ?? "user"}
      userName={session.user.name}
      userEmail={session.user.email}
    />
  )
}
