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
import { resolveAccountManagerReviewer,resolvePatronManager,resolveSubmissionReviewer } from "./submission-reviewer"
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

it("resolves the creating manager for project assignment, falling back only to an authorized manager",async()=>{
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("z-manager@example.com")
  expect(await resolvePatronManager("person@example.com")).toEqual({email:"z-manager@example.com",displayName:"Zed Manager"})
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("admin@example.com")
  expect(await resolvePatronManager("person@example.com")).toEqual({email:"a-manager@example.com",displayName:"Alex Manager"})
})

it("uses the alphabetically first authorized manager when no manager provisioned the patron",async()=>{
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("admin@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toEqual({email:"a-manager@example.com",displayName:"Alex Manager",assignment:"available_manager"})
})

it("uses the enabled account manager as the default reviewer ahead of ordinary managers",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"a-manager@example.com",role:"manager",accessStatus:"active",displayName:"Alex Manager"},
    {email:"accounts@example.com",role:"account_manager",accessStatus:"active",displayName:"Morgan Accounts"},
  ])
  vi.mocked(getEffectivePermissions).mockImplementation(async email=>email==="accounts@example.com"
    ? {role:"account_manager",permissions:resolvePermissions("account_manager")}
    : {role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("a-manager@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toEqual({email:"accounts@example.com",displayName:"Morgan Accounts",assignment:"available_manager"})
})

it("falls back to a regular manager when the account manager review right is revoked",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"accounts@example.com",role:"account_manager",accessStatus:"active",displayName:"Morgan Accounts"},
    {email:"a-manager@example.com",role:"manager",accessStatus:"active",displayName:"Alex Manager"},
  ])
  vi.mocked(getEffectivePermissions).mockImplementation(async email=>email==="accounts@example.com"
    ? {role:"account_manager",permissions:resolvePermissions("account_manager",{review_entries:false})}
    : {role:"manager",permissions:resolvePermissions("manager")})
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("admin@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toEqual({email:"a-manager@example.com",displayName:"Alex Manager",assignment:"available_manager"})
})

it("does not assign an owner as their own reviewer and returns null without an authorized manager",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([{email:"person@example.com",role:"manager",accessStatus:"active",displayName:"Person"}])
  vi.mocked(getAccountIdentityCreator).mockResolvedValue("person@example.com")
  expect(await resolveSubmissionReviewer("person@example.com")).toBeNull()
})

it("routes extension requests only to an active account manager with review permission",async()=>{
  vi.mocked(actorRoster).mockResolvedValue([
    {email:"disabled@example.com",role:"account_manager",accessStatus:"suspended",displayName:"Disabled"},
    {email:"manager@example.com",role:"manager",accessStatus:"active",displayName:"Manager"},
    {email:"accounts@example.com",role:"account_manager",accessStatus:"active",displayName:"Accounts"},
  ])
  vi.mocked(getEffectivePermissions).mockImplementation(async email=>email==="accounts@example.com"
    ?{role:"account_manager",permissions:resolvePermissions("account_manager")}
    :{role:"manager",permissions:resolvePermissions("manager")})
  expect(await resolveAccountManagerReviewer("patron@example.com")).toEqual({email:"accounts@example.com",displayName:"Accounts",assignment:"available_manager"})
})
