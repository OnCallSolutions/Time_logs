"use client"

/**
 * Provides the main role-aware timesheet workspace and navigation.
 *
 * This client component owns the visible application state after authentication:
 * loaded entries, current tab, sync errors, and optimistic edit behavior. It also
 * translates the user's role into visible navigation choices so the UI matches
 * the permissions enforced by the API routes.
 */
import { useEffect, useState } from "react"
import { BarChart3, Clock3, ListChecks, ShieldCheck } from "lucide-react"
import { AccountProfile } from "@/components/account-profile"
import { NoteInput } from "@/components/note-input"
import { EntriesLog } from "@/components/entries-log"
import { ManagerReport } from "@/components/manager-report"
import { SignOutButton } from "@/components/sign-out-button"
import { apiPath } from "@/lib/paths"
import type { ParsedEntry, TimeEntry, UserRole } from "@/lib/types"

type View = "log" | "report" | "admin"

/**
 * Coordinates the signed-in user's role-aware timesheet workspace.
 *
 * The app receives the effective role from the server-rendered page and uses it
 * to decide which tabs, descriptions, and bulk actions to expose. Data mutations
 * still go through the API, so this component improves ergonomics without being
 * the source of authorization truth.
 *
 * @param props - Role and signed-in user identity for the current session.
 * @param props.role - Effective role used to choose visible navigation.
 * @param props.userName - Display name from Microsoft authentication.
 * @param props.userEmail - Email from Microsoft authentication.
 * @returns The interactive timesheet application shell.
 */
export function TimesheetApp({
  role,
  userName,
  userEmail,
}: {
  role: UserRole
  userName?: string | null
  userEmail?: string | null
}) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [view, setView] = useState<View>("log")
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    /**
     * Loads saved entries visible to the signed-in user's role.
     *
     * The API decides whether the caller receives personal entries or team-wide
     * entries. The local active flag prevents state updates after unmounting while
     * the request is still in flight.
     *
     * @returns A promise that resolves after entries are loaded or an error is stored.
     */
    async function loadEntries() {
      try {
        const res = await fetch(apiPath("/api/entries"), { cache: "no-store" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to load entries.")
        if (active) setEntries(data.entries ?? [])
      } catch (err) {
        if (active) {
          setSyncError(
            err instanceof Error ? err.message : "Failed to load entries.",
          )
        }
      } finally {
        if (active) setLoadingEntries(false)
      }
    }

    loadEntries()

    return () => {
      active = false
    }
  }, [])

  const canViewTeamReports = role === "admin" || role === "manager"
  const canViewAdmin = role === "admin"
  const canClearVisibleEntries = role === "admin" || role === "manager"
  const roleLabel = {
    admin: "Administrator",
    manager: "Manager",
    worker: "Worker",
    user: "User",
  }[role]

  useEffect(() => {
    if (view === "report" && !canViewTeamReports) setView("log")
    if (view === "admin" && !canViewAdmin) setView("log")
  }, [canViewAdmin, canViewTeamReports, view])

  /**
   * Persists newly parsed entries and prepends them to the local view.
   *
   * Parsed entries come from the note input and do not have ids yet. The API
   * stores them under the current user and returns database-backed entries that
   * can be edited or deleted immediately.
   *
   * @param parsed - Entries returned by the AI parser.
   * @returns A promise that resolves after entries are saved and local state updates.
   */
  async function addParsed(parsed: ParsedEntry[]) {
    const res = await fetch(apiPath("/api/entries"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: parsed }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Failed to save entries.")
    setEntries((prev) => [...(data.entries ?? []), ...prev])
    setSyncError(null)
  }

  /**
   * Optimistically updates one entry and rolls back if the API rejects it.
   *
   * The user sees edits immediately while the PATCH request runs. If the backend
   * rejects the change because of validation, permissions, or connectivity, the
   * previous entry list is restored and a sync error is shown.
   *
   * @param id - Entry id to update.
   * @param patch - Partial entry fields to apply.
   * @returns Nothing; local state and API sync happen as side effects.
   */
  function updateEntry(id: string, patch: Partial<TimeEntry>) {
    const previous = entries
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )

    fetch(apiPath(`/api/entries/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to update entry.")
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? data.entry : e)),
        )
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to update entry.",
        )
      })
  }

  /**
   * Optimistically removes one entry and restores it if deletion fails.
   *
   * Deletion follows the same optimistic pattern as editing. The API still checks
   * ownership and role scope, so a locally visible row cannot be removed unless
   * the server confirms permission.
   *
   * @param id - Entry id to delete.
   * @returns Nothing; local state and API sync happen as side effects.
   */
  function deleteEntry(id: string) {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))

    fetch(apiPath(`/api/entries/${id}`), { method: "DELETE" })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to delete entry.")
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to delete entry.",
        )
      })
  }

  /**
   * Clears every entry visible to the signed-in user's role.
   *
   * This action is only exposed to managers and administrators. The backend uses
   * the same role information to decide whether "visible" means team-wide data or
   * the current user's own entries.
   *
   * @returns Nothing; local state and API sync happen as side effects.
   */
  function clearEntries() {
    const previous = entries
    setEntries([])

    fetch(apiPath("/api/entries"), { method: "DELETE" })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to clear entries.")
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        setSyncError(
          err instanceof Error ? err.message : "Failed to clear entries.",
        )
      })
  }

  const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)

  const tabs: { key: View; label: string; icon: typeof ListChecks }[] = [
    {
      key: "log",
      label: canViewTeamReports ? "Team entries" : "My entries",
      icon: ListChecks,
    },
    ...(canViewTeamReports
      ? [{ key: "report" as const, label: "Team report", icon: BarChart3 }]
      : []),
    ...(canViewAdmin
      ? [{ key: "admin" as const, label: "Admin", icon: ShieldCheck }]
      : []),
  ]

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[1600px] flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
      <header className="flex flex-col gap-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2 text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Timesheet
            </span>
          </div>
          <div className="flex items-center justify-end gap-3">
            <AccountProfile
              email={userEmail}
              fallbackName={userName}
              role={roleLabel}
            />
            <SignOutButton />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Contractor hours, from messy notes to a manager report
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Paste time-worked notes in any format. AI extracts structured entries you
          can review and edit, then rolls them into a clean report of hours per
          contractor.
        </p>
      </header>

      <RoleOverview role={role} />

      <NoteInput onParsed={addParsed} />

      {(loadingEntries || syncError) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            syncError
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
          role={syncError ? "alert" : "status"}
        >
          {syncError ?? "Loading saved entries..."}
        </div>
      )}

      {/* View switch */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              view === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {key === "log" && entries.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${
                  view === key
                    ? "bg-primary-foreground/20"
                    : "bg-muted-foreground/15"
                }`}
              >
                {entries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "log" ? (
        <EntriesLog
          entries={entries}
          onUpdate={updateEntry}
          onDelete={deleteEntry}
          onClear={clearEntries}
          canClear={canClearVisibleEntries}
          description={
            canViewTeamReports
              ? "Review and edit visible team entries for your role."
              : "Review and edit your own saved time entries."
          }
          title={canViewTeamReports ? "Team entries" : "My time entries"}
        />
      ) : view === "report" ? (
        entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <p className="text-sm font-medium">Nothing to report yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add some entries first and the manager report will build itself.
            </p>
          </div>
        ) : (
          <ManagerReport entries={entries} />
        )
      ) : (
        <AdminPanel />
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        {entries.length} entries ·{" "}
        {totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h logged
        this session · data is saved to Neon
      </footer>
    </main>
  )
}

/**
 * Shows the active role and what that role can do.
 *
 * The panel is intentionally informational: it helps the signed-in user understand
 * why they see a personal log, team report, or admin controls. Permission checks
 * remain enforced in the API layer.
 *
 * @param props - Component props.
 * @param props.role - Effective role for the signed-in user.
 * @returns A role summary panel.
 */
function RoleOverview({ role }: { role: UserRole }) {
  const content = {
    admin: {
      title: "Admin access",
      body: "You can view and manage all entries, use team reporting, and access admin controls.",
    },
    manager: {
      title: "Manager access",
      body: "You can view team entries and build manager reports across the visible team data.",
    },
    worker: {
      title: "Worker access",
      body: "You can create, edit, and manage your own time entries.",
    },
    user: {
      title: "User access",
      body: "You can create and manage your own time entries.",
    },
  }[role]

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-sm font-medium">{content.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{content.body}</p>
    </section>
  )
}

/**
 * Explains where administrators configure role assignments.
 *
 * The app currently reads roles from environment variables instead of providing a
 * database-backed admin editor. This panel makes that operational model visible
 * to administrators from inside the app.
 *
 * @returns The administrator information panel.
 */
function AdminPanel() {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Admin controls</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Role assignments are currently controlled through environment variables:
        ADMIN_EMAILS, MANAGER_EMAILS, WORKER_EMAILS, and ALLOWED_EMAILS.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Team visibility
          </p>
          <p className="mt-1 text-sm">
            Admins and managers can view all saved entries returned by the API.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Self-service users
          </p>
          <p className="mt-1 text-sm">
            Workers and users are scoped to entries owned by their signed-in email.
          </p>
        </div>
      </div>
    </section>
  )
}
