/**
 * Verifies locked reviewer routing based on the account provisioner and active
 * manager rights. Self-registered/admin-provisioned patrons use one stable,
 * authorized manager until an administrator configures an explicit assignment.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/account-identities",()=>({getAccountIdentityCreator:vi.fn()}))
vi.mock("@/lib/collaboration",()=>({actorRoster:vi.fn()}))
vi.mock("@/lib/effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
import { getAccountIdentityCreator } from "@/lib/account-identities"
import { actorRoster } from "@/lib/collaboration"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { resolveSubmissionReviewer } from "./submission-reviewer"
import { resolvePermissions } from "./permissions"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"z-manager@example.com",role:"manager",accessStatus:"active",displayName:"Zed Manager"},
    {email:"a-manager@example.com",role:"manager",accessStatus:"active",displayName:"Alex Manager"},
    {email:"viewer@example.com",role:"manager",accessStatus:"active",displayName:"View Only"},
  ])
  vi.mocked(getEffectivePermissions).mockImplementation(async email=>({role:"manager",permissions:resolvePermissions("manager",email==="viewer@example.com"?{review_entries:false}:undefined)}))
})

it("routes a patron to the eligible manager who added the account",async()=>{
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("z-manager@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toEqual({email:"z-manager@example.com",displayName:"Zed Manager",assignment:"added_by_manager"})
})

it("uses the alphabetically first authorized manager when no manager provisioned the patron",async()=>{
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("admin@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toEqual({email:"a-manager@example.com",displayName:"Alex Manager",assignment:"available_manager"})
})

it("does not assign an owner as their own reviewer and returns null without an authorized manager",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([{email:"person@example.com",role:"manager",accessStatus:"active",displayName:"Person"}])
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("person@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toBeNull()
})
