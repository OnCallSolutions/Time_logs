/**
 * Tests request-time cutoff and temporary assignment precedence without storage.
 * Exact time boundaries must remain secure even when the scheduler is unavailable.
 */
import { expect,it } from "vitest"
import { activeTemporaryRights,lifecycleDeniesAccess,type AccountLifecycle,type TemporaryAssignment } from "./access-lifecycle-policy"
const now=Date.parse("2026-10-10T12:00:00Z")
const lifecycle:AccountLifecycle={email:"staff@example.com",cutoffAt:null,suspended:false,reviewAt:null,reason:"Departure",updatedBy:"admin@example.com"}
const assignment:TemporaryAssignment={id:"grant",email:"staff@example.com",permissions:["review_entries","view_team"],scope:"all",startsAt:"2026-10-10T11:00:00Z",endsAt:"2026-10-10T13:00:00Z",grantedBy:"admin@example.com",reason:"Coverage",revokedAt:null}
it("denies at the exact cutoff and never auto-reactivates suspension",()=>{
  expect(lifecycleDeniesAccess({...lifecycle,cutoffAt:"2026-10-10T12:00:00Z"},now)).toBe(true)
  expect(lifecycleDeniesAccess({...lifecycle,cutoffAt:"2026-10-10T12:00:01Z"},now)).toBe(false)
  expect(lifecycleDeniesAccess({...lifecycle,suspended:true,reviewAt:"2026-10-09T12:00:00Z"},now)).toBe(true)
})
it("fails closed for malformed persisted deadlines",()=>{
  expect(lifecycleDeniesAccess({...lifecycle,cutoffAt:"invalid"},now)).toBe(true)
})
it("grants only within the half-open activation interval",()=>{
  expect(activeTemporaryRights([assignment],now)).toEqual({review_entries:true,view_team:true})
  expect(activeTemporaryRights([assignment],Date.parse(assignment.endsAt))).toEqual({})
  expect(activeTemporaryRights([assignment],Date.parse(assignment.startsAt)-1)).toEqual({})
})
it("does not apply revoked grants or team rights under own scope",()=>{
  expect(activeTemporaryRights([{...assignment,revokedAt:"2026-10-10T11:30:00Z"}],now)).toEqual({})
  expect(activeTemporaryRights([{...assignment,scope:"own"}],now)).toEqual({})
})
