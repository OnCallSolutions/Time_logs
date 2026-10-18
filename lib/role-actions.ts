/** Describes only workflows the current role can actually open. */
export type RoleActionId = "log_time" | "timesheets" | "approvals" | "reports" | "projects" | "team_access" | "account_activity" | "final_approvals" | "period_settings"

export type RoleActionPermissions = {
  create_entries?: boolean
  review_entries?: boolean
  ai_review?: boolean
  view_reports?: boolean
  manage_projects?: boolean
  create_projects?: boolean
  delegate_permissions?: boolean
  view_personal_reports?: boolean
  view_accounts?: boolean
  view_all_timesheets?: boolean
  manage_timesheet_periods?: boolean
}

export type RoleAction = { id: RoleActionId; label: string }

/**
 * Returns role-specific launchpad actions using effective permissions.
 * Actions are navigation/workflow entry points; mutation authorization remains server-side.
 */
export function getRoleActions(role: "employee" | "contractor" | "manager" | "account_manager", permissions: RoleActionPermissions): RoleAction[] {
  const actions: RoleAction[] = []
  if (permissions.create_entries) actions.push({ id: "log_time", label: role === "contractor" ? "Log project time" : "Log time" })

  if (role === "account_manager") {
    if (permissions.view_accounts) actions.push({ id: "final_approvals", label: "Final approvals" })
    if (permissions.view_all_timesheets) actions.push({ id: "timesheets", label: "Timesheet archive" })
    if (permissions.manage_timesheet_periods) actions.push({ id: "period_settings", label: "Period settings" })
    if (permissions.manage_projects) actions.push({ id: "projects", label: "Projects and assignments" })
    if (permissions.view_reports) actions.push({ id: "reports", label: "Reports" })
    return actions
  }

  actions.push({ id: "timesheets", label: role === "contractor" ? "My submissions" : "My timesheets" })
  if (permissions.review_entries || permissions.ai_review) actions.push({ id: "approvals", label: "Team approvals" })
  if (permissions.view_reports || permissions.view_personal_reports) actions.push({ id: "reports", label: role === "manager" ? "Team reports" : "My reports" })
  if (role === "contractor" && permissions.view_personal_reports) actions.push({ id: "account_activity", label: "Account activity" })
  if (permissions.manage_projects || ((role === "employee" || role === "contractor") && permissions.create_projects)) actions.push({ id: "projects", label: permissions.manage_projects ? "Projects and assignments" : "My projects" })
  if (role === "manager" && permissions.delegate_permissions) actions.push({ id: "team_access", label: "Team access" })
  return actions
}
