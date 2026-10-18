/**
 * Verifies submitted-only managerial visibility and independent scoped assistance.
 * Fixtures exercise rights revocation and exact evidence binding without database I/O.
 */
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("./access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("./effective-permissions",()=>({getEffectivePermissions:vi.fn()}))
vi.mock("./review-requests",()=>({listReviewRequests:vi.fn()}))
import { getEffectiveUserRole } from "./access"
import { getEffectivePermissions } from "./effective-permissions"
import { listReviewRequests } from "./review-requests"
import { directReviewAccess,createReviewAccess } from "./review-access"
import { resolvePermissions } from "./permissions"
import type { TimeEntry } from "./types"
const entry:TimeEntry={id:"one",ownerEmail:"owner@example.com",contractor:"Person",project:"Project",date:"2026-10-15",hours:2,description:"Work",status:"submitted",revision:"original",reviewManagerEmail:"primary@example.com"}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getEffectiveUserRole).mockResolvedValue("contractor");vi.mocked(listReviewRequests).mockResolvedValue([]);vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager")})})
it.each(["draft","approved","rejected"] as const)("hides another person's %s records from managers",status=>{
  expect(directReviewAccess({...entry,status},"primary@example.com",{role:"manager",permissions:resolvePermissions("manager")},"contractor")).toEqual({visible:false,reviewable:false})
})
it("separates cross-manager visibility from approval",()=>{
  expect(directReviewAccess(entry,"helper@example.com",{role:"manager",permissions:resolvePermissions("manager")},"contractor").visible).toBe(false)
  expect(directReviewAccess(entry,"helper@example.com",{role:"manager",permissions:resolvePermissions("manager",{view_other_manager_entries:true})},"contractor")).toEqual({visible:true,reviewable:false})
  expect(directReviewAccess(entry,"helper@example.com",{role:"manager",permissions:resolvePermissions("manager",{view_other_manager_entries:true,review_other_manager_entries:true})},"contractor").reviewable).toBe(true)
})
it("requires both explicit rights for manager-personal assistance",()=>{
  expect(directReviewAccess(entry,"helper@example.com",{role:"manager",permissions:resolvePermissions("manager",{view_manager_entries:true})},"manager")).toEqual({visible:true,reviewable:false})
  expect(directReviewAccess(entry,"helper@example.com",{role:"manager",permissions:resolvePermissions("manager",{view_manager_entries:true,review_manager_entries:true})},"manager").reviewable).toBe(true)
  expect(directReviewAccess(entry,"admin@example.com",{role:"admin",permissions:resolvePermissions("admin",{view_manager_entries:true,review_manager_entries:true})},"manager").reviewable).toBe(false)
})
it("lets an account manager review only assigned submitted workforce timesheets",()=>{
  const assigned={...entry,reviewManagerEmail:"accounts@example.com"}
  const rights=resolvePermissions("account_manager")
  expect(directReviewAccess(assigned,"accounts@example.com",{role:"account_manager",permissions:rights},"contractor")).toEqual({visible:true,reviewable:true})
  expect(directReviewAccess(assigned,"accounts@example.com",{role:"account_manager",permissions:rights},"employee").reviewable).toBe(true)
  expect(directReviewAccess(entry,"accounts@example.com",{role:"account_manager",permissions:rights},"contractor")).toEqual({visible:true,reviewable:false})
  expect(directReviewAccess(assigned,"accounts@example.com",{role:"account_manager",permissions:resolvePermissions("account_manager",{review_entries:false})},"contractor")).toEqual({visible:true,reviewable:false})
})
it("lets account managers view all periods without expanding their approval authority",()=>{
  const rights=resolvePermissions("account_manager")
  const unrelatedDraft={...entry,status:"draft" as const,reviewManagerEmail:"other@example.com"}
  expect(directReviewAccess(unrelatedDraft,"accounts@example.com",{role:"account_manager",permissions:rights},"contractor")).toEqual({visible:true,reviewable:false})
  expect(directReviewAccess({...entry,reviewManagerEmail:"other@example.com"},"accounts@example.com",{role:"account_manager",permissions:rights},"contractor")).toEqual({visible:true,reviewable:false})
  expect(directReviewAccess({...entry,reviewManagerEmail:"accounts@example.com"},"accounts@example.com",{role:"account_manager",permissions:rights},"contractor").reviewable).toBe(true)
  expect(directReviewAccess(unrelatedDraft,"accounts@example.com",{role:"account_manager",permissions:resolvePermissions("account_manager",{view_all_timesheets:false})},"contractor")).toEqual({visible:false,reviewable:false})
})
it("never permits self-review despite every cross-manager right",()=>{
  expect(directReviewAccess(entry,"owner@example.com",{role:"manager",permissions:resolvePermissions("manager",{view_manager_entries:true,review_manager_entries:true,view_other_manager_entries:true,review_other_manager_entries:true})},"manager")).toEqual({visible:true,reviewable:false})
})
it("honors an active exact-revision request without global cross-manager rights",async()=>{
  vi.mocked(listReviewRequests).mockResolvedValue([{entry_id:"one",sender_email:"primary@example.com",source_revision:"original"}] as never)
  expect(await createReviewAccess("helper@example.com",{role:"manager",permissions:resolvePermissions("manager")})(entry)).toEqual({visible:true,reviewable:true})
})
it("revokes scoped assistance when the grantor loses delegation rights",async()=>{
  vi.mocked(listReviewRequests).mockResolvedValue([{entry_id:"one",sender_email:"primary@example.com",source_revision:"original"}] as never)
  vi.mocked(getEffectivePermissions).mockResolvedValue({role:"manager",permissions:resolvePermissions("manager",{delegate_permissions:false})})
  expect((await createReviewAccess("helper@example.com",{role:"manager",permissions:resolvePermissions("manager")})(entry)).visible).toBe(false)
})
it("does not extend a grant to changed evidence or a recipient refusing requests",async()=>{
  vi.mocked(listReviewRequests).mockResolvedValue([{entry_id:"one",sender_email:"primary@example.com",source_revision:"older"}] as never)
  expect((await createReviewAccess("helper@example.com",{role:"manager",permissions:resolvePermissions("manager")})(entry)).visible).toBe(false)
  vi.mocked(listReviewRequests).mockClear()
  expect((await createReviewAccess("helper@example.com",{role:"manager",permissions:resolvePermissions("manager",{accept_review_requests:false})})(entry)).visible).toBe(false)
  expect(listReviewRequests).not.toHaveBeenCalled()
})
