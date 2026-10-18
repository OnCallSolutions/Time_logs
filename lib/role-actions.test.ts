import { describe, expect, it } from "vitest"
import { getRoleActions } from "./role-actions"

describe("getRoleActions", () => {
  it("offers contractors only permitted personal workflows", () => {
    expect(getRoleActions("contractor", { create_entries: true, view_reports: true, view_personal_reports: true }).map(action => action.id))
      .toEqual(["log_time", "timesheets", "reports", "account_activity"])
  })

  it("shows project creation to contractors and employees only when specifically authorized", () => {
    expect(getRoleActions("contractor", { create_projects: true }).map(action => action.id)).toContain("projects")
    expect(getRoleActions("employee", { create_projects: false }).map(action => action.id)).not.toContain("projects")
  })

  it("shows manager controls only when the effective permissions allow them", () => {
    expect(getRoleActions("manager", { review_entries: true, manage_projects: true }).map(action => action.id))
      .toEqual(["timesheets", "approvals", "projects"])
    expect(getRoleActions("manager", {}).map(action => action.id)).toEqual(["timesheets"])
  })

  it("provides account managers with final approval and period controls independently", () => {
    expect(getRoleActions("account_manager", { view_accounts: true, manage_timesheet_periods: true }).map(action => action.id))
      .toEqual(["final_approvals", "period_settings"])
  })

  it("offers employees a personal report without granting team reports", () => {
    expect(getRoleActions("employee", { view_personal_reports: true }).map(action => action.id))
      .toEqual(["timesheets", "reports"])
  })
})
