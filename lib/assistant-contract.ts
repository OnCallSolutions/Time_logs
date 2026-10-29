/**
 * Defines the assistant's finite action vocabulary and bounded untrusted inputs.
 * Model output is a proposal, never JavaScript, SQL, a URL or a permission grant.
 * Both the server and review window validate the same payload shape.
 */
import { z } from "zod"
import type { Permissions } from "./permissions"
import { delegablePermissions, permissionLabels, type Permission } from "./permissions"
import type { UserRole } from "./types"
const permissionKeys = Object.keys(permissionLabels) as [Permission, ...Permission[]]
export const assistantEntrySchema = z.object({
  contractor: z.string().trim().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive().max(24), project: z.string().trim().min(1).max(160), description: z.string().max(2000),
}).strict()
export const assistantActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), destination: z.enum(["home", "period-index", "log", "personal", "approvals", "report", "my-report", "activity", "admin", "permissions", "accounts", "periods", "messages"]) }).strict(),
  z.object({ kind: z.literal("create_entries"), periodId:z.string().uuid(), periodName:z.string().trim().min(2).max(100), entries: z.array(assistantEntrySchema).min(1).max(30) }).strict(),
  z.object({ kind: z.literal("edit_entry"), id: z.string().uuid(), expectedRevision: z.string().min(1).max(100),
    fields: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hours: z.number().positive().max(24).optional(),
      project: z.string().trim().min(1).max(160).optional(), description: z.string().max(2000).optional() }).strict().refine(value=>Object.keys(value).length>0) }).strict(),
  z.object({ kind: z.literal("delete_entry"), id: z.string().uuid(), expectedRevision: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal("update_entry"), id: z.string().uuid(), expectedRevision: z.string().min(1).max(100),
    status: z.enum(["draft", "submitted", "approved", "rejected"]), reviewNote: z.string().max(500), reviewManagerEmail: z.string().email().nullable() }).strict(),
  z.object({ kind: z.literal("compose_message"), recipient: z.string().email(), body: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal("mark_messages_read"), ids: z.array(z.string().uuid()).min(1).max(50) }).strict(),
  z.object({ kind: z.literal("delete_message"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("update_rights"), email: z.string().email(), permissions: z.record(z.enum(permissionKeys), z.boolean()).refine(value=>Object.keys(value).length>0) }).strict(),
])
export type AssistantAction = z.infer<typeof assistantActionSchema>
export const assistantResponseSchema = z.object({ answer: z.string().min(1).max(6000), actions: z.array(assistantActionSchema).max(5) }).strict()
export type AssistantProposal = { action: AssistantAction; token: string }
export const assistantInputSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }).strict()).min(1).max(12),
  workspaceContext: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/).default("main"),
  handoffContext: z.string().max(4000).optional(),
  messageContext: z.string().max(5000).optional(),
  periodId:z.string().uuid().optional(),
}).strict()

/**
 * Filters proposals by current control rights; record-level checks run at execution.
 * @param action - Schema-validated action proposed by the model.
 * @param access - Live role and permission resolution from the authenticated session.
 * @returns boolean indicating whether this control can be offered.
 */
export function canOfferAction(action: AssistantAction, access: { role: UserRole | null; permissions: Permissions }): boolean {
  const { role, permissions: p } = access
  if (!role) return false
  if (action.kind === "create_entries") return p.create_entries
  if (action.kind === "compose_message") return p.send_messages && (role === "admin" || role === "manager")
  if (action.kind === "mark_messages_read") return true
  if (action.kind === "delete_message") return p.send_messages && (role === "admin" || role === "manager")
  if (action.kind === "update_rights") return p.delegate_permissions && (role === "admin" || (role === "manager" && Object.keys(action.permissions).every(key=>delegablePermissions.includes(key as Permission))))
  if (action.kind === "edit_entry") return p.edit_entries
  if (action.kind === "delete_entry") return p.delete_entries
  if (action.kind === "update_entry") return ["approved", "rejected"].includes(action.status)
    ? p.review_entries || p.review_manager_entries : p.submit_entries
  switch (action.destination) {
    case "home":
    case "messages": return true
    case "period-index": return p.create_entries || p.view_all_timesheets || p.manage_timesheet_periods
    case "log": return p.create_entries || p.view_all_timesheets
    case "personal": return p.create_entries || p.view_personal_reports
    case "approvals": return p.review_entries || p.review_manager_entries || p.ai_review
    case "report": return p.view_reports
    case "my-report": return p.view_personal_reports
    case "activity": return p.view_personal_reports || role === "admin"
    case "admin": return role === "admin"
    case "permissions": return p.delegate_permissions && (role === "admin" || role === "manager")
    case "accounts": return p.view_accounts && (role === "admin" || role === "account_manager")
    case "periods": return p.manage_timesheet_periods
  }
}
