/**
 * Tests group membership without expanding access or including blocked accounts.
 * Roster fixtures isolate audience rules from live identities and encryption keys.
 */
import { expect,it } from "vitest"
import { audienceEmails } from "./message-audience"
const roster=[{email:"staff@example.com",role:"employee",accessStatus:"active"},{email:"supplier@example.com",role:"contractor",accessStatus:"active"},{email:"lead@example.com",role:"manager",accessStatus:"active"},{email:"owner@example.com",role:"admin",accessStatus:"active"},{email:"blocked@example.com",role:"employee",accessStatus:"blocked"}]
it("distinguishes contractor and employee broadcasts",()=>{
  expect(audienceEmails(roster,"contractor",null)).toEqual(["supplier@example.com"])
  expect(audienceEmails(roster,"employee",null)).toEqual(["staff@example.com"])
})
it("includes every active role only for everyone",()=>{
  expect(audienceEmails(roster,"everyone",null)).toHaveLength(4)
  expect(audienceEmails(roster,"manager",null)).toEqual(["lead@example.com"])
  expect(audienceEmails(roster,"admin",null)).toEqual(["owner@example.com"])
})
it("does not accept blocked or unknown individual recipients",()=>{
  expect(audienceEmails(roster,"individual","blocked@example.com")).toEqual([])
  expect(audienceEmails(roster,"individual","OWNER@example.com")).toEqual(["owner@example.com"])
})
