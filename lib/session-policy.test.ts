/**
 * Verifies exact idle/absolute session limits and malformed timestamp rejection.
 * Pure policy tests use synthetic clocks without cookies, users or database writes.
 */
import {expect,it} from "vitest"
import {sessionIsActive,SESSION_IDLE_SECONDS,SESSION_MAX_SECONDS} from "./session-policy"
const start=Date.parse("2026-10-15T12:00:00Z")
it("allows a brief return but expires at the exact thirty-minute idle limit",()=>{
  expect(sessionIsActive(start,start,start+5*60000)).toBe(true)
  expect(sessionIsActive(start,start,start+SESSION_IDLE_SECONDS*1000)).toBe(false)
})
it("does not extend the original eight-hour limit through later activity",()=>{
  const active=start+(SESSION_MAX_SECONDS-60)*1000
  expect(sessionIsActive(start,active,start+SESSION_MAX_SECONDS*1000-1)).toBe(true)
  expect(sessionIsActive(start,active,start+SESSION_MAX_SECONDS*1000)).toBe(false)
})
it("rejects invalid or future activity rather than treating it as remembered access",()=>{
  expect(sessionIsActive(NaN,start,start)).toBe(false)
  expect(sessionIsActive(start,start+1,start)).toBe(false)
  expect(sessionIsActive(start,start-1,start)).toBe(false)
})
