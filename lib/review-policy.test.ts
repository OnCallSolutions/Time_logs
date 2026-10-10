/**
 * Verifies role separation for manager evidence independently of UI controls.
 * Decisions remain gated by live permissions and self-review checks in routes.
 */
import { expect,it } from "vitest"
import { canReviewRole } from "./review-policy"
it("routes manager work only to account managers",()=>{
  expect(canReviewRole("manager","manager")).toBe(false)
  expect(canReviewRole("admin","manager")).toBe(false)
  expect(canReviewRole("account_manager","manager")).toBe(true)
})
it("keeps account managers outside contractor operational review",()=>{
  expect(canReviewRole("account_manager","contractor")).toBe(false)
  expect(canReviewRole("manager","contractor")).toBe(true)
  expect(canReviewRole("admin",null)).toBe(false)
})
