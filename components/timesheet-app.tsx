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
import { Brand } from "@/components/brand"
import { EmployeeWorkspace } from "@/components/employee-workspace"
import { ApprovalSelection } from "@/components/approval-selection"
import { BusinessAccounts } from "@/components/business-accounts"
import { EmployeeRightsPanel, MessagesPanel } from "@/components/collaboration-panel"
import { useMessageInbox } from "@/components/use-message-inbox"
import { useMessageEncryption } from "@/components/use-message-encryption"
import { MessageNotifications } from "@/components/message-notifications"
import { notifyPermissionsChanged } from "@/lib/permission-events"
import { EntryReviewDialog, ManagerWorkspace } from "@/components/manager-workspace"
import { permissionLabels, resolvePermissions, type Permission, type PermissionOverrides } from "@/lib/permissions"
import { AdminWorkspace } from "@/components/admin-workspace"
import { AccessLifecyclePanel } from "@/components/access-lifecycle-panel"
import { SecurityRiskWindow } from "@/components/security-risk-window"
import { WindowSurface } from "@/components/window-surface"
import { WorkspaceUtilities } from "@/components/workspace-utilities"
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  ListChecks,
  MessageSquare,
  KeyRound,
  Pencil,
  Save,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react"
import { AccountProfile } from "@/components/account-profile"
import { NoteInput } from "@/components/note-input"
import { EntriesLog } from "@/components/entries-log"
import { ManagerReport } from "@/components/manager-report"
import { SignOutButton } from "@/components/sign-out-button"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import type {
  AccessStatus,
  EntryStatus,
  ParsedEntry,
  TimeEntry,
  UserRole,
} from "@/lib/types"

type View = "log" | "personal" | "approvals" | "report" | "admin" | "messages" | "permissions" | "accounts"

const manageableRoles: UserRole[] = ["admin", "manager", "account_manager", "employee", "contractor"]
const manageableStatuses: AccessStatus[] = ["active", "denied", "blocked"]

/**
 * User directory row returned by the administrator users API.
 *
 * The row combines env-configured access information with persisted profile and
 * timesheet activity so admins can audit both permission state and product usage.
 */
type AdminDirectoryUser = {
  environmentAdmin?: boolean
  permissions?: PermissionOverrides
  /** Normalized user email shown as the stable identity. */
  email: string
  /** Effective role from environment-backed access policy. */
  role: UserRole | "none"
  /** Current access state for this user. */
  accessStatus: AccessStatus | "observed"
  /** Source of the user's visible access state. */
  accessSource: "managed" | "environment" | "observed"
  /** Whether the email is explicitly present in an access environment variable. */
  accessConfigured: boolean
  /** Optional administrator note explaining managed access decisions. */
  note: string
  /** Administrator who last updated managed access. */
  updatedBy: string | null
  /** ISO timestamp for the last managed access update. */
  updatedAt: string | null
  /** Persisted profile display name, when available. */
  displayName: string
  /** Persisted profile image data URL, when available. */
  imageDataUrl: string | null
  /** Total entries owned by the user. */
  totalEntries: number
  /** Owned entries still in draft. */
  draftEntries: number
  /** Owned entries waiting for manager review. */
  submittedEntries: number
  /** Owned entries approved by a manager or admin. */
  approvedEntries: number
  /** Owned entries rejected by a manager or admin. */
  rejectedEntries: number
  /** ISO timestamp for the user's most recently created entry. */
  lastEntryAt: string | null
}

/**
 * Draft state for the admin access editor window.
 *
 * Admins change this state with buttons and inputs inside the modal. Nothing is
 * persisted until the Save button calls the user-management API.
 */
type AccessEditorState = {
  protectedAdmin?: boolean
  environmentAdmin?: boolean
  permissions?: PermissionOverrides
  /** Whether the editor is creating a new row or changing an existing user. */
  mode: "add" | "edit"
  /** Email being created or edited. */
  email: string
  /** Draft role selected by the admin. */
  role: UserRole
  /** Draft permission state selected by the admin. */
  accessStatus: AccessStatus
  /** Draft note explaining the role or permission decision. */
  note: string
}

/**
 * Security audit event returned by the administrator audit API.
 *
 * Events are append-only server records of sensitive actions. Metadata is compact
 * by design so the audit log identifies what changed without duplicating private
 * entry descriptions or profile image payloads.
 */
type AdminAuditEvent = {
  /** Stable audit event id generated by the database. */
  id: string
  /** Email of the signed-in actor who performed the action. */
  actorEmail: string
  /** Machine-readable action label. */
  action: string
  /** Type of entity affected by the action. */
  targetType: string
  /** Optional id of the affected entity. */
  targetId: string | null
  /** Sanitized contextual data about the action. */
  metadata: Record<string, unknown>
  /** Request IP address when available. */
  ipAddress: string | null
  /** Request user agent when available. */
  userAgent: string | null
  /** ISO timestamp for when the event occurred. */
  occurredAt: string
}

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
  role: initialRole,
  userName,
  userEmail,
}: {
  role: UserRole
  userName?: string | null
  userEmail?: string | null
}) {
  const [role,setRole] = useState(initialRole)
  const [permissions,setPermissions] = useState(() => resolvePermissions(null))
  const [accessDenied,setAccessDenied] = useState(false)
  const [permissionsLoaded,setPermissionsLoaded] = useState(false)
  const messageInbox=useMessageInbox(permissionsLoaded&&!accessDenied)
  const messageEncryption=useMessageEncryption(accessDenied?"":messageInbox.email,messageInbox.messages)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [view, setView] = useState<View>(role === "admin" ? "admin" : role === "manager" ? "approvals" : "log")
  const [messagesOpen,setMessagesOpen]=useState(false)
  useEffect(()=>{
    if(role==="account_manager"&&permissions.view_accounts)setView("accounts")
  },[role,permissions.view_accounts])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [personalStatus, setPersonalStatus] = useState<EntryStatus | "all">("all")
  const [suggestedReview,setSuggestedReview] = useState<{entry:TimeEntry;decision:"approved"|"rejected";reason:string}|null>(null)
  const [technologyReports,setTechnologyReports] = useState(false)
  const [lifecycleOpen,setLifecycleOpen]=useState(false)
  const [directoryRequest,setDirectoryRequest] = useState(0)
  const [workspaceWindow,setWorkspaceWindow] = useState<"overview"|"workflow"|"notes"|null>(null)

  useEffect(() => {
    const controller = new AbortController()
    /**
     * Refreshes server rights and role after admin saves or browser focus changes.
     * @returns Promise<void> after live authorization state is applied.
     */
    async function refreshPermissions(): Promise<void> {
      try {
        const response = await fetch(apiPath("/api/permissions"),{cache:"no-store",signal:controller.signal})
        const data = await response.json()
        if (!response.ok || !data.role) {
          setPermissionsLoaded(true); setAccessDenied(true); setPermissions(resolvePermissions(null)); setEntries([]); return
        }
        setPermissionsLoaded(true); setAccessDenied(false); setRole(data.role); setPermissions(data.permissions)
      } catch { if (!controller.signal.aborted) { setAccessDenied(true); setEntries([]); setPermissions(resolvePermissions(null)) } }
    }
    void refreshPermissions()
    const timer = window.setInterval(refreshPermissions,15000)
    window.addEventListener("focus",refreshPermissions)
    window.addEventListener("permissions-changed",refreshPermissions)
    const channel=typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("permissions-changed") : null
    if(channel)channel.onmessage=()=>void refreshPermissions()
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus",refreshPermissions); window.removeEventListener("permissions-changed",refreshPermissions); channel?.close() }
  },[])

  useEffect(() => {
    if (accessDenied) return
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
  }, [role,permissions.view_team,permissions.review_manager_entries,accessDenied])

  const canViewTeamReports = permissions.view_reports
  const canViewAdmin = role === "admin" && !accessDenied
  const canClearVisibleEntries = permissions.delete_entries && permissions.view_team
  const canReviewEntries = permissions.review_entries||(role==="account_manager"&&permissions.review_manager_entries)
  const canAIReview = permissions.ai_review||(role==="account_manager"&&permissions.review_manager_entries&&permissions.ai_accounts)
  const canSubmitEntries = permissions.submit_entries
  useEffect(() => {
    if (!canReviewEntries) setSuggestedReview(null)
  },[canReviewEntries])
  const roleLabel = {
    admin: "Administrator",
    manager: "Manager",
    account_manager: "Account Manager",
    employee: "Employee",
    contractor: "Contractor",
  }[role]

  useEffect(() => {
    if (!permissionsLoaded) return
    if (view === "report" && !canViewTeamReports) setView("log")
    if (view === "approvals" && !canReviewEntries && !canAIReview) setView("log")
    if (view === "admin" && !canViewAdmin) setView("log")
    if (view === "permissions" && (!permissions.delegate_permissions || (role !== "admin" && role !== "manager"))) setView("log")
    if (accessDenied && view === "messages") setView("log")
    if(view==="accounts"&&(accessDenied||!((permissions.send_to_accounts&&(role==="admin"||role==="manager"))||(permissions.view_accounts&&(role==="admin"||role==="account_manager")))))setView("log")
  }, [canReviewEntries, canViewAdmin, canViewTeamReports, view,permissionsLoaded,permissions.ai_review,permissions.delegate_permissions,permissions.send_to_accounts,permissions.view_accounts,role,accessDenied])

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
  function updateEntry(id: string, patch: Partial<TimeEntry>, expectedRevision?:string) {
    const previous = entries
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )

    fetch(apiPath(`/api/entries/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({...patch,expectedRevision:expectedRevision??entries.find(entry=>entry.id===id)?.revision}),
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
   * Moves one entry through the approval workflow.
   *
   * Status updates share the same optimistic update path as field edits.
   * Employees use this to submit draft or rejected rows, while managers and
   * administrators use it to approve or reject submitted rows.
   *
   * @param id - Entry id whose approval status should change.
   * @param status - New approval status to persist.
   * @param reviewNote - Optional manager rejection note.
   * @returns Nothing; local state and API sync happen as side effects.
   */
  function changeEntryStatus(
    id: string,
    status: EntryStatus,
    reviewNote?: string,
    expectedRevision?:string,
  ) {
    updateEntry(id, { status, reviewNote },expectedRevision)
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
        const refresh = await fetch(apiPath("/api/entries"), { cache: "no-store" })
        const current = await refresh.json()
        if (!refresh.ok) throw new Error(current.error ?? "Unable to refresh entries after clearing.")
        setEntries(current.entries ?? [])
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
  const pendingEntries = entries.filter((entry) => entry.status === "submitted"&&entry.reviewEligible!==false)
  const approvedEntries = entries.filter((entry) => entry.status === "approved")
  const rejectedEntries = entries.filter((entry) => entry.status === "rejected")
  const draftEntries = entries.filter((entry) => entry.status === "draft")

  const tabs: { key: View; label: string; icon: typeof ListChecks }[] = [
    ...(role==="manager"?[{key:"personal" as const,label:"My managerial time",icon:Clock3}]:[]),
    ...(!accessDenied&&((permissions.send_to_accounts&&(role==="manager"||role==="admin"))||(permissions.view_accounts&&(role==="account_manager"||role==="admin")))?[{key:"accounts" as const,label:"Business accounts",icon:BarChart3}]:[]),
    {
      key: "log",
      label: permissions.view_team ? "Team entries" : "My entries",
      icon: ListChecks,
    },
    ...(canReviewEntries || canAIReview
      ? [{ key: "approvals" as const, label: canReviewEntries?"Approvals":"AI review", icon: CheckCircle2 }]
      : []),
    ...(canViewTeamReports
      ? [{ key: "report" as const, label: "Reports", icon: BarChart3 }]
      : []),
    ...(canViewAdmin
      ? [{ key: "admin" as const, label: "Admin", icon: ShieldCheck }]
      : []),
    ...(permissions.delegate_permissions && (role === "admin" || role === "manager") ? [{key:"permissions" as const,label:"Employee rights",icon:KeyRound}] : []),
  ]

  return (
    <main className="app-workspace tech-surface flex min-h-svh w-full min-w-0 flex-col gap-4 bg-background px-3 pb-8 pt-4 sm:px-5 md:pt-5">
      {!accessDenied&&messagesOpen&&<WindowSurface title="Messages" onBack={()=>setMessagesOpen(false)}><section className="min-h-0 w-full overflow-auto bg-background p-3 sm:p-5"><MessagesPanel inbox={messageInbox} encryption={messageEncryption} canSend={permissions.send_messages&&(role==="admin"||role==="manager")}/></section></WindowSurface>}
      <header className="workspace-header flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Brand />
          <div className="flex min-w-0 items-center justify-end gap-3">
            {!accessDenied&&<WorkspaceUtilities unread={messageInbox.unread} onMessages={()=>setMessagesOpen(true)}/>}
            <AccountProfile
              email={userEmail}
              fallbackName={userName}
              role={roleLabel}
            />
            <SignOutButton />
          </div>
        </div>
        {!accessDenied&&<MessageNotifications inbox={messageInbox} onOpen={()=>setMessagesOpen(true)}/>}
        <h1 className="text-2xl font-semibold text-balance">
          {role === "admin" ? "Technology management" : role === "account_manager" ? "Business accounts" : role === "manager" ? "Team workspace" : "My timesheet"}
        </h1>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={()=>setWorkspaceWindow("overview")}><Users className="size-4"/>Workspace overview</Button>
        <Button variant="outline" size="sm" onClick={()=>setWorkspaceWindow("workflow")}><BarChart3 className="size-4"/>Workflow totals</Button>
        {permissions.create_entries&&<Button variant="outline" size="sm" onClick={()=>setWorkspaceWindow("notes")}><Pencil className="size-4"/>Log time notes</Button>}
      </div>
      {canViewAdmin && <AdminWorkspace onDirectory={() => {setView("admin");setDirectoryRequest(value=>value+1)}} onSecurity={() => setTechnologyReports(true)} onLifecycle={()=>setLifecycleOpen(true)}/>}
      {!accessDenied&&role==="manager"&&permissions.delegate_permissions&&<Button variant="outline" className="w-fit" onClick={()=>setLifecycleOpen(true)}><KeyRound className="size-4"/>Temporary coverage</Button>}
      {lifecycleOpen&&!accessDenied&&(canViewAdmin||(role==="manager"&&permissions.delegate_permissions))&&<WindowSurface title={canViewAdmin?"Access lifecycle":"Temporary coverage"} onBack={()=>setLifecycleOpen(false)}><section className="min-h-0 w-full overflow-auto bg-white"><AccessLifecyclePanel key={role} admin={canViewAdmin} permissions={permissions}/></section></WindowSurface>}
      {canViewAdmin && technologyReports && <SecurityRiskWindow onClose={() => setTechnologyReports(false)} />}

      {workspaceWindow&&<WindowSurface title={workspaceWindow==="notes"?"Log time notes":workspaceWindow==="overview"?"Workspace overview":"Workflow totals"} onBack={()=>setWorkspaceWindow(null)}><section className="flex min-h-0 w-full max-w-6xl flex-col bg-white"><div className="min-h-0 flex-1 overflow-auto p-4">
      {workspaceWindow==="overview"?<RoleOverview role={role}/>:workspaceWindow==="notes"?<NoteInput onParsed={parsed=>{addParsed(parsed);setWorkspaceWindow(null);setView("log")}}/>:<WorkflowOverview
        approvedCount={approvedEntries.length}
        draftCount={draftEntries.length}
        pendingCount={pendingEntries.length}
        rejectedCount={rejectedEntries.length}
        role={role}
      />}
      </div></section></WindowSurface>}
      {(role === "employee" || role === "contractor") && <EmployeeWorkspace contractor={role==="contractor"} entries={entries} selected={personalStatus} onSelect={setPersonalStatus} />}
      {role==="manager"&&view==="personal"&&<EmployeeWorkspace entries={entries.filter(entry=>entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())} selected={personalStatus} onSelect={setPersonalStatus}/>}
      {!accessDenied && (canReviewEntries || canAIReview || canViewTeamReports) && <ManagerWorkspace canReview={canReviewEntries} canReports={canViewTeamReports} canAI={canAIReview} pending={pendingEntries.length} entries={pendingEntries} onApprovals={() => setView("approvals")} onReports={() => setView("report")} onRecommendation={(entry,decision,reason) => setSuggestedReview({entry,decision,reason})} />}
      {suggestedReview && <EntryReviewDialog entry={suggestedReview.entry} decision={suggestedReview.decision} initialNote={suggestedReview.reason} onCancel={() => setSuggestedReview(null)} onConfirm={note => {
        changeEntryStatus(suggestedReview.entry.id,suggestedReview.decision,note || undefined,suggestedReview.entry.revision)
        setSuggestedReview(null)
      }} />}
      {accessDenied && <p role="alert">Access is unavailable. Contact your administrator.</p>}
      {!accessDenied&&view==="approvals"&&(role==="manager"||role==="admin"||role==="account_manager")&&(canReviewEntries||permissions.ai_review)&&<ApprovalSelection entries={pendingEntries} email={userEmail??""} canReview={canReviewEntries} canAI={canAIReview} onUpdated={entry=>setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}/>}

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
      <div aria-label="Workspace views" className="sticky top-0 z-10 grid grid-cols-2 gap-1 border-y border-border bg-card p-1 sm:flex sm:flex-wrap sm:items-center">
        {tabs.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant="ghost"
            help={`Open ${label.toLowerCase()} using your current role and permissions.`}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              view === key
                ? "bg-accent text-primary ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {key==="messages"&&messageInbox.unread>0&&<span className="rounded-full bg-primary px-1.5 text-xs text-white" aria-label={`${messageInbox.unread} unread messages`}>{messageInbox.unread}</span>}
            {key === "log" && entries.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${
                  view === key
                    ? "bg-primary/10"
                    : "bg-muted-foreground/15"
                }`}
              >
                {entries.length}
              </span>
            )}
            {key === "approvals" && pendingEntries.length > 0 && (
              <span
                className={`ml-1 rounded-full px-1.5 text-xs tabular-nums ${
                  view === key
                    ? "bg-primary/10"
                    : "bg-muted-foreground/15"
                }`}
              >
                {pendingEntries.length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {view === "log" || view === "personal" ? (
        <EntriesLog
          entries={view==="personal"?entries.filter(entry=>entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase()&&(personalStatus==="all"||entry.status===personalStatus)):(role === "employee" || role === "contractor") && personalStatus !== "all" ? entries.filter(entry => entry.status === personalStatus) : entries}
          onUpdate={updateEntry}
          onStatusChange={changeEntryStatus}
          onDelete={deleteEntry}
          onClear={clearEntries}
          canClear={view!=="personal"&&canClearVisibleEntries}
          canReview={view!=="personal"&&canReviewEntries}
          canSubmit={canSubmitEntries}
          canEdit={permissions.edit_entries}
          canDelete={permissions.delete_entries}
          description={
            permissions.view_team
              ? "Review, edit, and manage team entries for your role."
              : "Review, edit, and submit your own saved time entries."
          }
          title={view==="personal"?"My managerial time — independent review required":permissions.view_team ? "Team entries" : role==="contractor"?"Contractor time submissions":"Internal employee time"}
        />
      ) : view === "approvals" ? (
        pendingEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <p className="text-sm font-medium">No entries waiting for approval</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted time will appear here for manager review.
            </p>
          </div>
        ) : (
          <EntriesLog
            entries={pendingEntries}
            onUpdate={updateEntry}
            onStatusChange={changeEntryStatus}
            onDelete={deleteEntry}
            onClear={clearEntries}
            canClear={false}
            canReview={canReviewEntries}
            canSubmit={false}
            canEdit={permissions.edit_entries}
            canDelete={permissions.delete_entries}
            description="Approve or reject submitted time after review."
            title="Pending approvals"
          />
        )
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
      ) : view === "accounts" ? (
        <BusinessAccounts key={`${role}:${permissions.send_to_accounts}:${permissions.view_accounts}:${permissions.review_accounts}:${permissions.ai_accounts}`} canSend={permissions.send_to_accounts&&(role==="manager"||role==="admin")} canReview={permissions.view_accounts&&permissions.review_accounts&&(role==="account_manager"||role==="admin")} canAI={permissions.view_accounts&&permissions.ai_accounts&&(role==="account_manager"||role==="admin")}/>
      ) : view === "messages" ? (
        <MessagesPanel inbox={messageInbox} canSend={permissions.send_messages && (role === "admin" || role === "manager")} />
      ) : view === "permissions" ? (
        role === "admin" ? <AdminPanel role={role} rightsOnly openRequest={directoryRequest} /> : <EmployeeRightsPanel permissions={permissions} />
      ) : (
        <AdminPanel role={role} openRequest={directoryRequest} />
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        {entries.length} entries ·{" "}
        {totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h logged
        total · {approvedEntries.length} approved
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
    account_manager: {
      title: "Business accounts",
      body: "Account review and manager-timesheet approval require administrator-granted rights. Financial evidence review does not release funds.",
    },
    admin: {
      title: "Admin access",
      body: "Manage technology access and review operational work. Manager timesheets require an authorized account manager.",
    },
    manager: {
      title: "Manager access",
      body: "You can review submitted time, approve or reject entries, and build team reports.",
    },
    employee: {
      title: "Employee access",
      body: "You can create, edit, and submit your own time entries for manager approval.",
    },
    contractor: {
      title: "Contractor access",
      body: "You can create and submit your own time entries for review.",
    },
  }[role]

  return (
    <section className="border-l-2 border-primary bg-card px-4 py-2">
      <p className="text-sm font-medium">{content.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{content.body}</p>
    </section>
  )
}

/**
 * Shows a compact status dashboard for the current role's visible entries.
 *
 * Counts are derived from the same entry list used by the active table and report
 * views, so employees see their own progress while managers see team workflow load.
 *
 * @param props - Workflow summary counts and current user role.
 * @param props.approvedCount - Number of visible approved entries.
 * @param props.draftCount - Number of visible draft entries.
 * @param props.pendingCount - Number of visible submitted entries.
 * @param props.rejectedCount - Number of visible rejected entries.
 * @param props.role - Effective role for the signed-in user.
 * @returns A role-aware workflow status summary.
 */
function WorkflowOverview({
  approvedCount,
  draftCount,
  pendingCount,
  rejectedCount,
  role,
}: {
  approvedCount: number
  draftCount: number
  pendingCount: number
  rejectedCount: number
  role: UserRole
}) {
  const reviewLabel =
    role === "admin" || role === "manager"
      ? "Waiting for your review"
      : "Waiting for manager review"

  const items = [
    { label: "Draft", value: draftCount, icon: ListChecks },
    { label: reviewLabel, value: pendingCount, icon: Send },
    { label: "Approved", value: approvedCount, icon: CheckCircle2 },
    { label: "Rejected", value: rejectedCount, icon: XCircle },
  ]

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="border-b border-border bg-card px-3 py-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{label}</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {value}
          </p>
        </div>
      ))}
    </section>
  )
}

/**
 * Shows administrators the users known to the app and access configuration.
 *
 * The panel combines environment configuration, admin-managed access rows, and
 * observed product activity. It orders people by seniority and forces role or
 * permission edits through an explicit editor window and Save action.
 *
 * @param props - Admin panel props.
 * @param props.role - Effective role for the signed-in user.
 * @returns The administrator user directory panel, or null for non-admin roles.
 */
function AdminPanel({ role, rightsOnly = false,openRequest = 0 }: { role: UserRole; rightsOnly?: boolean;openRequest?:number }) {
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([])
  const [allActivityEvents, setAllActivityEvents] = useState<AdminAuditEvent[]>([])
  const [activityWindowOpen, setActivityWindowOpen] = useState(false)
  const [directoryOpen,setDirectoryOpen] = useState(rightsOnly)
  const [totalsOpen,setTotalsOpen] = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [accessEditor, setAccessEditor] = useState<AccessEditorState | null>(
    null,
  )
  const [savingUser, setSavingUser] = useState<string | null>(null)
  const [managementError, setManagementError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(()=>{if(rightsOnly)setDirectoryOpen(true)},[rightsOnly])
  useEffect(()=>{if(openRequest)setDirectoryOpen(true)},[openRequest])

  useEffect(() => {
    let active = true

    if (role !== "admin") {
      setLoading(false)
      return () => {
        active = false
      }
    }

    /**
     * Loads administrator directory and audit data from the server.
     *
     * The APIs enforce admin-only access. Directory data supports operational
     * access review, while audit data supports security investigation.
     *
     * @returns A promise that resolves after admin data loads or an error is stored.
     */
    async function loadAdminData() {
      try {
        const [usersRes, auditRes] = await Promise.all([
          fetch(apiPath("/api/users"), { cache: "no-store" }),
          rightsOnly ? Promise.resolve(Response.json({events:[]})) : fetch(apiPath("/api/audit?limit=25"), { cache: "no-store" }),
        ])
        const usersData = await usersRes.json()
        const auditData = await auditRes.json()
        if (!usersRes.ok) {
          throw new Error(usersData.error ?? "Failed to load users.")
        }
        if (!auditRes.ok) {
          throw new Error(auditData.error ?? "Failed to load audit events.")
        }
        if (active) {
          setUsers(sortAdminDirectoryUsers(usersData.users ?? []))
          setAuditEvents(auditData.events ?? [])
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load admin data.",
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadAdminData()

    return () => {
      active = false
    }
  }, [role,rightsOnly])

  if (role !== "admin") {
    return null
  }

  const configuredCount = users.filter((user) => user.accessConfigured).length
  const submittedCount = users.reduce(
    (sum, user) => sum + user.submittedEntries,
    0,
  )
  const sortedUsers = sortAdminDirectoryUsers(users)

  /**
   * Applies a saved managed access assignment to the visible directory.
   *
   * The user-management API returns the saved access row, not the full directory
   * summary. This helper preserves any activity counts already loaded for that
   * email while updating role, status, note, and source fields.
   *
   * @param managedUser - Saved managed access row returned by the API.
   * @returns Nothing; directory state is updated as a side effect.
   */
  function applyManagedAccessUser(managedUser: {
    permissions?: PermissionOverrides
    email: string
    role: UserRole
    accessStatus: AccessStatus
    note: string
    updatedBy: string | null
    updatedAt: string | null
  }) {
    setUsers((previous) => {
      const normalizedEmail = managedUser.email.toLowerCase()
      const existing = previous.find((user) => user.email === normalizedEmail)
      const nextUser: AdminDirectoryUser = {
        environmentAdmin: existing?.environmentAdmin ?? false,
        email: normalizedEmail,
        role: managedUser.role,
        accessStatus: managedUser.accessStatus,
        accessSource: "managed",
        accessConfigured: true,
        note: managedUser.note,
        permissions: managedUser.permissions ?? {},
        updatedBy: managedUser.updatedBy,
        updatedAt: managedUser.updatedAt,
        displayName: existing?.displayName ?? "",
        imageDataUrl: existing?.imageDataUrl ?? null,
        totalEntries: existing?.totalEntries ?? 0,
        draftEntries: existing?.draftEntries ?? 0,
        submittedEntries: existing?.submittedEntries ?? 0,
        approvedEntries: existing?.approvedEntries ?? 0,
        rejectedEntries: existing?.rejectedEntries ?? 0,
        lastEntryAt: existing?.lastEntryAt ?? null,
      }
      const withoutUser = previous.filter((user) => user.email !== normalizedEmail)
      return sortAdminDirectoryUsers([...withoutUser, nextUser])
    })
  }

  /**
   * Saves a managed access assignment through the admin users API.
   *
   * This function is only called by the editor window's Save button. Successful
   * changes are reflected immediately and audited server-side by the API route.
   *
   * @param payload - Access assignment values to persist.
   * @returns True when the assignment is saved, otherwise false.
   */
  async function saveManagedUserAccess(payload: {
    permissions?: PermissionOverrides
    email: string
    role: UserRole
    accessStatus: AccessStatus
    note?: string
  }) {
    setSavingUser(payload.email.toLowerCase())
    setManagementError(null)

    try {
      const res = await fetch(apiPath("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save user access.")
      }
      applyManagedAccessUser(data.user)
      notifyPermissionsChanged()
      return true
    } catch (err) {
      setManagementError(
        err instanceof Error ? err.message : "Failed to save user access.",
      )
      return false
    } finally {
      setSavingUser(null)
    }
  }

  /**
   * Opens the dynamic access editor for a new employee record.
   *
   * @returns Nothing; editor state is prepared for a new managed user.
   */
  function openAddUserEditor() {
    setManagementError(null)
    setAccessEditor({
      mode: "add",
      email: "",
      role: "employee",
      accessStatus: "active",
      note: "",
    })
  }

  /**
   * Opens the dynamic access editor for an existing directory row.
   *
   * Observed users do not have a saved permission state yet, so the editor starts
   * them as active employees until the admin chooses a different role or status.
   *
   * @param user - Directory row to edit.
   * @returns Nothing; editor state is prepared from the selected user.
   */
  function openEditUserEditor(user: AdminDirectoryUser) {
    setManagementError(null)
    setAccessEditor({
      mode: "edit",
      email: user.email,
      role: user.role === "none" ? "employee" : user.role,
      accessStatus:
        user.accessStatus === "observed" ? "active" : user.accessStatus,
      note: user.note,
      permissions: user.permissions ?? {},
      environmentAdmin: user.environmentAdmin,
      protectedAdmin: user.environmentAdmin || (user.role === "admin" && user.accessStatus === "active" && users.filter(person=>person.role === "admin" && person.accessStatus === "active").length <= 1),
    })
  }

  /**
   * Saves the current editor draft through the admin users API.
   *
   * The Save button is the only UI path that persists role or permission changes.
   * The modal remains open when validation or the server rejects the request.
   *
   * @returns A promise that resolves after the save attempt finishes.
   */
  async function saveAccessEditor() {
    if (!accessEditor || !accessEditor.email.trim()) return

    const saved = await saveManagedUserAccess({
      email: accessEditor.email.trim(),
      role: accessEditor.role,
      accessStatus: accessEditor.accessStatus,
      note: accessEditor.note.trim(),
      permissions: accessEditor.permissions,
    })

    if (saved) {
      setAccessEditor(null)
    }
  }

  /**
   * Opens the full admin activity window and loads extended audit events.
   *
   * The compact admin panel only shows a short preview. This loader fetches the
   * largest bounded audit set supported by the API so administrators can inspect
   * broader app activity without exposing the view to non-admin roles.
   *
   * @returns A promise that resolves after the activity window is populated.
   */
  async function openActivityWindow() {
    setActivityWindowOpen(true)
    setActivityError(null)

    if (allActivityEvents.length > 0) return

    setActivityLoading(true)
    try {
      const res = await fetch(apiPath("/api/audit?limit=250"), {
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load app activity.")
      }
      setAllActivityEvents(data.events ?? [])
    } catch (err) {
      setActivityError(
        err instanceof Error ? err.message : "Failed to load app activity.",
      )
    } finally {
      setActivityLoading(false)
    }
  }

  const activityEvents = allActivityEvents.length > 0 ? allActivityEvents : auditEvents

  return (
    <div className="tech-surface flex flex-col gap-4 bg-white text-slate-950">
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
        <Button variant="outline" size="sm" onClick={()=>setDirectoryOpen(true)}><Users className="size-4"/>{rightsOnly?"Actor rights":"User directory"}</Button>
        <Button variant="outline" size="sm" onClick={()=>setTotalsOpen(true)}><BarChart3 className="size-4"/>Directory totals</Button>
        {!rightsOnly&&<Button variant="outline" size="sm" onClick={openActivityWindow}><Activity className="size-4"/>View all app activity</Button>}
        <span className="text-xs text-muted-foreground">{users.length} actors · {users.filter(user=>user.role==="admin"&&user.accessStatus==="active").length} active admins</span>
      </div>
      {directoryOpen&&<WindowSurface title={rightsOnly?"Employee rights":"User directory"} onBack={()=>setDirectoryOpen(false)}>
      <section className="flex min-h-0 w-full flex-col overflow-hidden bg-white">
        <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Admin user directory</h2>
        </div>
      </div>


        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Employee access</h3>
          </div>
          <Button
            type="button"
            className="w-fit bg-primary text-white hover:bg-primary/90"
            onClick={openAddUserEditor}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Add employee
          </Button>
          {managementError && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {managementError}
            </p>
          )}
        </div>

      {loading || error ? (
        <div
          className={`m-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? "Loading users..."}
        </div>
      ) : users.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium">No known users yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Configured users and profile activity will appear here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Permission</th>
                <th className="px-4 py-2 font-medium">Rights</th>
                <th className="px-4 py-2 text-right font-medium">Entries</th>
                <th className="px-4 py-2 text-right font-medium">Review</th>
                <th className="px-4 py-2 font-medium">Last entry</th>
                <th className="sticky right-0 bg-white px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => (
                <tr
                  key={user.email}
                  className="border-b border-slate-200 last:border-0"
                >
                  <td className="px-4 py-2">
                    <p className="font-medium">{user.displayName || user.email}</p>
                    {user.displayName && (
                      <p className="text-xs text-slate-500">{user.email}</p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${roleBadgeClass(user.role)}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-2">
                      <span
                        className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${accessStatusClass(user.accessStatus)}`}
                      >
                        {user.accessSource}: {user.accessStatus}
                      </span>
                      {user.note && (
                        <p className="max-w-56 text-xs text-slate-500">
                          {user.note}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {Object.values(resolvePermissions(user.role==="none"||user.accessStatus!=="active"?null:user.role,user.permissions)).filter(Boolean).length} allowed
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {user.totalEntries}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {user.submittedEntries} pending · {user.approvedEntries} approved
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {user.lastEntryAt ? formatAdminDate(user.lastEntryAt) : "—"}
                  </td>
                  <td className="sticky right-0 bg-white px-4 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                      onClick={() => openEditUserEditor(user)}
                      disabled={savingUser === user.email}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
      </WindowSurface>}
      {totalsOpen&&<WindowSurface title="Directory totals" onBack={()=>setTotalsOpen(false)}><section className="w-full bg-white p-4"><h2 className="mb-4 font-semibold">Directory totals</h2><div className="grid gap-3 sm:grid-cols-3"><AdminStat icon={Users} label="Directory users" value={users.length}/><AdminStat icon={ShieldCheck} label="Configured access" value={configuredCount}/><AdminStat icon={CheckCircle2} label="Awaiting review" value={submittedCount}/></div></section></WindowSurface>}

      {activityWindowOpen && (
        <AdminActivityWindow
          events={activityEvents}
          error={activityError}
          loading={activityLoading}
          onClose={() => setActivityWindowOpen(false)}
        />
      )}
      {accessEditor && (
        <AdminUserAccessEditor
          editor={accessEditor}
          error={managementError}
          saving={savingUser === accessEditor.email.toLowerCase()}
          onChange={(nextEditor) => setAccessEditor(nextEditor)}
          onClose={() => {
            if (!savingUser) setAccessEditor(null)
          }}
          onSave={saveAccessEditor}
        />
      )}
    </div>
  )
}

/**
 * Renders the admin-only user access editor window.
 *
 * The editor deliberately separates selecting role or permission values from
 * saving them. Admins can click through choices in this window, but the server is
 * contacted only when they press Save.
 *
 * @param props - Access editor props.
 * @param props.editor - Current editor draft state.
 * @param props.error - Optional save error returned by the admin API.
 * @param props.saving - Whether the current editor row is being saved.
 * @param props.onChange - Callback for updating draft editor state.
 * @param props.onClose - Callback invoked when the editor is dismissed.
 * @param props.onSave - Callback invoked by the Save button.
 * @returns The dynamic role and permission editor window.
 */
function AdminUserAccessEditor({
  editor,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  editor: AccessEditorState
  error: string | null
  saving: boolean
  onChange: (nextEditor: AccessEditorState) => void
  onClose: () => void
  onSave: () => void
}) {
  const title =
    editor.mode === "add" ? "Add employee access" : "Edit employee access"

  return (
    <WindowSurface title={title} onBack={onClose} disabled={saving}>
      <section
        tabIndex={-1}
        className="tech-surface flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">{title}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Select the role and permission state, then click Save to apply the
              change.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
            title="Close access editor"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close access editor</span>
          </Button>
        </div>

        <div className="grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain p-4 lg:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            Employee email
            <input
              type="email"
              value={editor.email}
              onChange={(event) =>
                onChange({ ...editor, email: event.target.value })
              }
              placeholder="employee@company.com"
              disabled={editor.mode === "edit" || saving}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <div>
            <p className="text-xs font-medium text-slate-600">Role</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {manageableRoles.map((roleOption) => (
                <button
                  key={roleOption}
                  type="button"
                  onClick={() => onChange({ ...editor, role: roleOption })}
                  aria-pressed={editor.role === roleOption}
                  disabled={saving || editor.protectedAdmin}
                  className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition ${
                    editor.role === roleOption
                      ? "border-primary bg-primary text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {roleOption}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {roleRights(editor.role).join(" · ")}
            </p>
            {editor.protectedAdmin&&<p className="mt-2 text-xs text-primary">{editor.environmentAdmin?"Recovery administrators are managed in deployment settings.":"At least one active admin is required. Add another admin before changing this role or access state."}</p>}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-600">
              Permission state
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {manageableStatuses.map((statusOption) => (
                <button
                  key={statusOption}
                  type="button"
                  onClick={() =>
                    onChange({ ...editor, accessStatus: statusOption })
                  }
                  aria-pressed={editor.accessStatus === statusOption}
                  disabled={saving || editor.protectedAdmin}
                  className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition ${
                    editor.accessStatus === statusOption
                      ? accessStatusClass(statusOption)
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {statusOption}
                </button>
              ))}
            </div>
          </div>

          <label className="text-xs font-medium text-slate-600">
            Administrator note
            <textarea
              value={editor.note}
              onChange={(event) =>
                onChange({ ...editor, note: event.target.value })
              }
              placeholder="Optional reason for this role or permission change"
              maxLength={500}
              disabled={saving}
              className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <fieldset className="grid gap-2 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">Control permissions</legend>
            {(Object.entries(permissionLabels) as [Permission,string][]).map(([permission,label]) => <label key={permission} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={saving} checked={resolvePermissions(editor.role,editor.permissions)[permission]} onChange={event => onChange({...editor,permissions:{...editor.permissions,[permission]:event.target.checked}})} />{label}
            </label>)}
            <Button variant="outline" disabled={saving} onClick={() => onChange({...editor,permissions:{}})}>Use role defaults</Button>
          </fieldset>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-primary text-white hover:bg-primary/90"
            onClick={onSave}
            disabled={saving || !editor.email.trim()}
          >
            <Save className="size-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </section>
    </WindowSurface>
  )
}

/**
 * Renders the full administrator activity window.
 *
 * This modal-style window stays inside the admin-only panel and presents a larger
 * audit-event set with detailed target, request, and metadata information. The
 * white surface is intentionally explicit so administrators can distinguish this
 * security review area from the rest of the app workspace.
 *
 * @param props - Activity window props.
 * @param props.events - Audit events to display.
 * @param props.error - Optional loading error.
 * @param props.loading - Whether extended audit events are loading.
 * @param props.onClose - Callback invoked when the window is dismissed.
 * @returns The admin-only full activity window.
 */
function AdminActivityWindow({
  events,
  error,
  loading,
  onClose,
}: {
  events: AdminAuditEvent[]
  error: string | null
  loading: boolean
  onClose: () => void
}) {
  const [selectedEvent, setSelectedEvent] = useState<AdminAuditEvent | null>(
    null,
  )
  const [showSecurity, setShowSecurity] = useState(false)

  return (
    <WindowSurface title="All app activity" onBack={onClose}>
      <section className="tech-surface flex min-h-0 w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-950">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">All app activity</h2>
              <Button variant="outline" onClick={() => setShowSecurity(true)}>Security risks</Button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Full admin view of recent audited actions across entries, profiles,
              approvals, and deletions.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            title="Close activity window"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close activity window</span>
          </Button>
        </div>

        {showSecurity && <SecurityRiskWindow onClose={() => setShowSecurity(false)} />}
        {loading || error ? (
          <div
            className={`m-4 rounded-lg border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
            role={error ? "alert" : "status"}
          >
            {error ?? "Loading app activity..."}
          </div>
        ) : events.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No app activity recorded yet</p>
            <p className="mt-1 text-xs text-slate-600">
              Audited actions will appear here after users change app data.
            </p>
          </div>
        ) : (
          <div tabIndex={0} aria-label="Activity table" className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">User agent</th>
                  <th className="px-4 py-2 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className={`cursor-pointer border-b border-slate-200 align-top outline-none last:border-0 hover:bg-accent focus:bg-accent ${
                      selectedEvent?.id === event.id ? "bg-accent" : ""
                    }`}
                    tabIndex={0}
                    onClick={() => setSelectedEvent(event)}
                    onKeyDown={(keyboardEvent) => {
                      if (
                        keyboardEvent.key === "Enter" ||
                        keyboardEvent.key === " "
                      ) {
                        keyboardEvent.preventDefault()
                        setSelectedEvent(event)
                      }
                    }}
                  >
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatAdminDateTime(event.occurredAt)}
                    </td>
                    <td className="px-4 py-3 font-medium">{event.actorEmail}</td>
                    <td className="px-4 py-3">{formatAuditAction(event.action)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>{event.targetType}</p>
                      <p className="mt-1 break-all font-mono">
                        {event.targetId ?? "No target id"}
                      </p>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-xs text-slate-600">
                      <span className="line-clamp-1">
                        {event.userAgent ?? "Unknown"}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-slate-600">
                      <p className="truncate">{formatAuditMetadata(event)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedEvent && (
          <AdminActivityEventDetails
            key={selectedEvent.id}
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </section>
    </WindowSurface>
  )
}

/**
 * Renders full data and metadata for a selected audit activity event.
 *
 * The detail panel is intentionally read-only and white, matching the admin
 * activity window while exposing the complete event record needed for review.
 *
 * @param props - Detail panel props.
 * @param props.event - Selected audit event to inspect.
 * @param props.onClose - Callback invoked when the detail panel is dismissed.
 * @returns Selected audit event detail panel.
 */
function AdminActivityEventDetails({
  event,
  onClose,
}: {
  event: AdminAuditEvent
  onClose: () => void
}) {
  const details = [
    { label: "Event ID", value: event.id },
    { label: "Occurred", value: formatAdminDateTime(event.occurredAt) },
    { label: "Actor", value: event.actorEmail },
    { label: "Action", value: formatAuditAction(event.action) },
    { label: "Target type", value: event.targetType },
    { label: "Target ID", value: event.targetId ?? "No target id" },
    { label: "IP address", value: event.ipAddress ?? "Unknown" },
    { label: "User agent", value: event.userAgent ?? "Unknown" },
  ]

  return (
    <WindowSurface title="Activity detail" onBack={onClose}>
    <section className="w-full max-w-5xl overflow-y-auto overscroll-contain bg-white p-4">
      <div className="sticky top-0 z-[1] mb-3 flex items-start justify-between gap-4 bg-white pb-2">
        <div>
          <h3 className="text-sm font-semibold">Activity detail</h3>
          <p className="mt-1 text-xs text-slate-600">
            {formatAuditAction(event.action)} by {event.actorEmail}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
          onClick={onClose}
          title="Close detail"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Close detail</span>
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <dl className="grid gap-2 sm:grid-cols-2">
          {details.map((detail) => (
            <div
              key={detail.label}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {detail.label}
              </dt>
              <dd className="mt-1 break-words text-sm text-slate-900">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Metadata
          </p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs leading-relaxed text-slate-800">
            {formatAuditMetadataBlock(event)}
          </pre>
        </div>
      </div>
    </section>
    </WindowSurface>
  )
}

/**
 * Renders a compact statistic for the admin directory header.
 *
 * @param props - Statistic props.
 * @param props.icon - Lucide icon component used beside the label.
 * @param props.label - Human-readable statistic label.
 * @param props.value - Numeric statistic value.
 * @returns Admin directory statistic tile.
 */
function AdminStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-950">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  )
}

/**
 * Converts roles into a seniority rank for admin directory ordering.
 *
 * Admins appear first, then managers, employees, base users, and finally
 * observed accounts without an assigned role.
 *
 * @param role - Role to rank for directory sorting.
 * @returns Numeric seniority rank used for descending ordering.
 */
function roleSeniority(role: UserRole | "none") {
  if (role === "admin") return 4
  if (role === "manager") return 3
  if (role === "account_manager") return 3
  if (role === "employee") return 2
  if (role === "contractor") return 1
  return 0
}

/**
 * Sorts admin directory rows from highest to lowest seniority.
 *
 * Rows with the same role are ordered alphabetically by email so the directory is
 * stable after saves, reloads, and API responses.
 *
 * @param users - Directory rows to order.
 * @returns A new array sorted by role seniority and email.
 */
function sortAdminDirectoryUsers(users: AdminDirectoryUser[]) {
  return [...users].sort((a, b) => {
    const seniorityDelta = roleSeniority(b.role) - roleSeniority(a.role)
    if (seniorityDelta !== 0) return seniorityDelta
    return a.email.localeCompare(b.email)
  })
}

/**
 * Returns the visible rights granted by a role.
 *
 * The labels are intentionally short so they can fit inside the admin directory
 * table while still making each role's practical permissions clear.
 *
 * @param role - Role assigned to the user.
 * @returns Human-readable rights labels for the role.
 */
function roleRights(role: UserRole | "none") {
  if (role === "account_manager") return ["admin-assigned business account rights"]
  if (role === "admin") {
    return ["all entries", "approvals", "reports", "users", "audit"]
  }
  if (role === "manager") {
    return ["team entries", "approvals", "reports"]
  }
  if (role === "employee") {
    return ["own entries", "submit time"]
  }
  if (role === "contractor") {
    return ["own entries", "submit time"]
  }
  return ["no assigned rights"]
}

/**
 * Returns the white-admin-table badge style for a user role.
 *
 * @param role - Role shown in the admin directory.
 * @returns Tailwind classes for the role badge.
 */
function roleBadgeClass(role: UserRole | "none") {
  if (role === "account_manager") return "border-rose-200 bg-rose-50 text-rose-700"
  if (role === "admin") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }
  if (role === "manager") {
    return "border-cyan-200 bg-cyan-50 text-cyan-700"
  }
  if (role === "employee") {
    return "border-green-200 bg-green-50 text-green-700"
  }
  if (role === "contractor") {
    return "border-slate-200 bg-slate-50 text-slate-700"
  }
  return "border-slate-200 bg-slate-100 text-slate-500"
}

/**
 * Returns the white-admin-table badge style for an access status.
 *
 * @param status - Access status shown in the admin directory.
 * @returns Tailwind classes for the status badge.
 */
function accessStatusClass(status: AccessStatus | "observed") {
  if (status === "active") {
    return "border-green-200 bg-green-50 text-green-700"
  }
  if (status === "denied") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  if (status === "blocked") {
    return "border-red-200 bg-red-50 text-red-700"
  }
  return "border-slate-200 bg-slate-100 text-slate-600"
}

/**
 * Formats an admin directory timestamp for compact table display.
 *
 * Invalid timestamps are returned unchanged so the admin can still see the raw
 * value instead of losing potentially useful diagnostic information.
 *
 * @param value - ISO timestamp returned by the user directory API.
 * @returns Localized date label or original value when parsing fails.
 */
function formatAdminDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Formats an audit timestamp with date and time for investigation views.
 *
 * Invalid timestamps are returned unchanged so administrators can still inspect
 * raw values if an upstream data issue occurs.
 *
 * @param value - ISO timestamp returned by the audit API.
 * @returns Localized date-time label or original value when parsing fails.
 */
function formatAdminDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Converts a machine audit action into a readable label.
 *
 * @param action - Machine-readable audit action.
 * @returns Human-readable audit action label.
 */
function formatAuditAction(action: string) {
  return action.replaceAll("_", " ")
}

/**
 * Shortens long target identifiers for compact table display.
 *
 * Email targets are already readable, while UUID-like ids are shortened so the
 * audit table stays scannable on smaller screens.
 *
 * @param id - Target id from an audit event.
 * @returns Compact target id label.
 */
function shortId(id: string) {
  if (id.includes("@")) return id
  return id.length > 8 ? id.slice(0, 8) : id
}

/**
 * Formats sanitized audit metadata for admin table display.
 *
 * The metadata intentionally describes changed fields and workflow status rather
 * than full sensitive values. This keeps the security log informative but narrow.
 *
 * @param event - Audit event whose metadata should be summarized.
 * @returns Compact metadata summary.
 */
function formatAuditMetadata(event: AdminAuditEvent) {
  const parts: string[] = []
  const fields = event.metadata.changedFields
  const fromStatus = event.metadata.fromStatus
  const toStatus = event.metadata.toStatus

  if (typeof fromStatus === "string" && typeof toStatus === "string") {
    parts.push(`${fromStatus} to ${toStatus}`)
  }

  if (Array.isArray(fields) && fields.length > 0) {
    parts.push(`fields: ${fields.join(", ")}`)
  }

  const summary = parts.join(" · ") || `${Object.keys(event.metadata).length} metadata fields`
  return summary.length > 100 ? `${summary.slice(0, 97)}...` : summary
}

/**
 * Formats full audit metadata as readable JSON for the selected entry detail.
 *
 * The audit API already sanitizes metadata, so this formatter focuses on making
 * nested context easy to inspect in a fixed-width block.
 *
 * @param event - Audit event whose metadata should be rendered.
 * @returns Pretty-printed audit metadata.
 */
function formatAuditMetadataBlock(event: AdminAuditEvent) {
  return JSON.stringify(event.metadata, null, 2)
}
