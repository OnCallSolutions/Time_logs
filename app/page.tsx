import { Clock3, LogIn } from "lucide-react"
import { signIn, auth } from "@/auth"
import { Button } from "@/components/ui/button"
import { TimesheetApp } from "@/components/timesheet-app"

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

  return (
    <TimesheetApp
      userName={session.user.name}
      userEmail={session.user.email}
    />
  )
}
