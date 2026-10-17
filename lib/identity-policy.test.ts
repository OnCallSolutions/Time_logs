/**
 * Verifies official identity canonicalization, bounds and nickname independence.
 * Pure validation tests need neither a database nor Microsoft credentials.
 * Duplicate storage is separately enforced by unique database indexes.
 */
import { expect, it } from "vitest"
import { emailSchema, normalizeOfficialName, officialNameSchema, nicknameSchema } from "./identity-policy"
it("normalizes official words, hyphens, apostrophes and whitespace",()=>{
  expect(normalizeOfficialName("  mAURICE   oTIENO ")).toBe("Maurice Otieno")
  expect(officialNameSchema.parse("ANNE-MARIE O'NEILL")).toBe("Anne-Marie O'Neill")
  expect(officialNameSchema.parse("élÈNE müLLER")).toBe("Élène Müller")
})
it("rejects short, long, numeric and hidden official names",()=>{
  for(const name of ["A","a".repeat(81),"Person 123","\u200bPerson"]){expect(officialNameSchema.safeParse(name).success).toBe(false)}
})
it("normalizes email case without merging provider aliases",()=>{
  expect(emailSchema.parse(" Person+Work@EXAMPLE.com ")).toBe("person+work@example.com")
  expect(emailSchema.safeParse("not-an-email").success).toBe(false)
})
it("preserves nickname case and creative names without official title casing",()=>{
  expect(nicknameSchema.parse("mY_nICK99!")).toBe("mY_nICK99!")
})
