/**
 * Tests additive rights and explicit revocation independently of role names.
 * Denied accounts cannot regain permissions through stored administrator grants.
 */
import { expect, it } from "vitest"
import { resolvePermissions } from "./permissions"
it("retains existing defaults and supports explicit revocation",()=>{
  expect(resolvePermissions("manager").review_entries).toBe(true)
  expect(resolvePermissions("manager",{review_entries:false}).review_entries).toBe(false)
  expect(resolvePermissions("employee",{review_entries:true}).review_entries).toBe(true)
})
it("does not grant rights to denied accounts",()=>{
  expect(Object.values(resolvePermissions(null,{view_team:true,review_entries:true})).every(value=>!value)).toBe(true)
})
