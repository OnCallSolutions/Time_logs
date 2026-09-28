import "server-only"

export type UserRole = "admin" | "manager" | "worker" | "user"

function parseEmailList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function getAllowedEmails() {
  return parseEmailList(process.env.ALLOWED_EMAILS)
}

function getRoleEmails(role: UserRole) {
  if (role === "admin") return parseEmailList(process.env.ADMIN_EMAILS)
  if (role === "manager") return parseEmailList(process.env.MANAGER_EMAILS)
  if (role === "worker") return parseEmailList(process.env.WORKER_EMAILS)
  return []
}

export function getUserRole(email?: string | null): UserRole | null {
  if (!email) return null

  const normalizedEmail = email.toLowerCase()

  if (getRoleEmails("admin").includes(normalizedEmail)) return "admin"
  if (getRoleEmails("manager").includes(normalizedEmail)) return "manager"
  if (getRoleEmails("worker").includes(normalizedEmail)) return "worker"
  if (getAllowedEmails().includes(normalizedEmail)) return "user"

  return null
}

export function getEffectiveUserRole(email?: string | null): UserRole | null {
  return getUserRole(email) ?? (isAllowedEmail(email) ? "user" : null)
}

export function isAllowedEmail(email?: string | null) {
  const accessConfigured =
    getAllowedEmails().length > 0 ||
    getRoleEmails("admin").length > 0 ||
    getRoleEmails("manager").length > 0 ||
    getRoleEmails("worker").length > 0

  if (!accessConfigured) {
    return true
  }

  return getUserRole(email) !== null
}
