/**
 * Verifies role and allowlist resolution behavior.
 *
 * These tests protect the app's first authorization layer: environment recovery
 * access, admin-managed assignments, blocked users, and open-mode behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getManagedAccessUser } from "@/lib/db"
import {
  getConfiguredAccessUsers,
  getEffectiveUserRole,
  isAllowedEmail,
} from "@/lib/access"

vi.mock("@/lib/db", () => ({
  getManagedAccessUser: vi.fn(),
}))

const managedAccessMock = vi.mocked(getManagedAccessUser)
const accessEnvKeys = [
  "ADMIN_EMAILS",
  "MANAGER_EMAILS",
  "ACCOUNT_MANAGER_EMAILS",
  "EMPLOYEE_EMAILS",
  "WORKER_EMAILS",
  "ALLOWED_EMAILS",
  "CONTRACTOR_EMAILS",
]

/**
 * Clears role-related environment variables between tests.
 *
 * @returns Nothing; process.env is reset in-place for the next assertion.
 */
function clearAccessEnv() {
  for (const key of accessEnvKeys) {
    delete process.env[key]
  }
}

describe("access resolution", () => {
  beforeEach(() => {
    clearAccessEnv()
    managedAccessMock.mockReset()
    managedAccessMock.mockResolvedValue(null)
  })

  it("distinguishes outsourced contractors from internal employees",async()=>{
    process.env.CONTRACTOR_EMAILS="supplier@example.com"
    process.env.EMPLOYEE_EMAILS="staff@example.com"
    await expect(getEffectiveUserRole("supplier@example.com")).resolves.toBe("contractor")
    await expect(getEffectiveUserRole("staff@example.com")).resolves.toBe("employee")
    await expect(getEffectiveUserRole("unknown@example.com")).resolves.toBeNull()
  })

  it("keeps environment administrators as the highest recovery role", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com"
    process.env.MANAGER_EMAILS = "owner@example.com"

    managedAccessMock.mockResolvedValue({
      email: "owner@example.com",
      role: "employee",
      accessStatus: "blocked",
      note: "Should not block recovery admin",
      updatedBy: "admin@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(getEffectiveUserRole("OWNER@example.com")).resolves.toBe(
      "admin",
    )
  })

  it("allows admin-managed active users when environment policy exists", async () => {
    process.env.ADMIN_EMAILS = "admin@example.com"
    managedAccessMock.mockResolvedValue({
      email: "employee@example.com",
      role: "employee",
      accessStatus: "active",
      note: "",
      updatedBy: "admin@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(getEffectiveUserRole("employee@example.com")).resolves.toBe(
      "employee",
    )
    await expect(isAllowedEmail("employee@example.com")).resolves.toBe(true)
  })

  it("denies managed users whose access is blocked", async () => {
    process.env.ALLOWED_EMAILS = "employee@example.com"
    managedAccessMock.mockResolvedValue({
      email: "employee@example.com",
      role: "employee",
      accessStatus: "blocked",
      note: "Security review",
      updatedBy: "admin@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(getEffectiveUserRole("employee@example.com")).resolves.toBeNull()
    await expect(isAllowedEmail("employee@example.com")).resolves.toBe(false)
  })

  it("returns configured users once with the highest environment role", () => {
    process.env.MANAGER_EMAILS = "lead@example.com"
    process.env.ALLOWED_EMAILS = "lead@example.com, viewer@example.com"

    expect(getConfiguredAccessUsers()).toEqual([
      { email: "lead@example.com", role: "manager" },
      { email: "viewer@example.com", role: "contractor" },
    ])
  })

  it("defaults to base user access only when no access policy exists", async () => {
    await expect(getEffectiveUserRole("anyone@example.com")).resolves.toBe("contractor")

    process.env.ALLOWED_EMAILS = "approved@example.com"

    await expect(getEffectiveUserRole("anyone@example.com")).resolves.toBeNull()
  })
})
