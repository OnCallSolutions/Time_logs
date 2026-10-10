/**
 * Checks actionable model-service failures without exposing provider details.
 * Sensitive error text and response bodies must never reach public responses.
 */
import { expect,it } from "vitest"
import { APICallError } from "ai"
import { aiReviewFailure } from "./ai-review-errors"
it("distinguishes configuration and throttling without leaking provider secrets",()=>{
  const failure=(statusCode:number)=>new APICallError({message:"private-provider-detail",url:"https://provider.invalid/private",requestBodyValues:{},statusCode,responseBody:"secret-response"})
  expect(aiReviewFailure(failure(401)).code).toBe("AI_CONFIGURATION")
  expect(aiReviewFailure(failure(429)).status).toBe(429)
  expect(JSON.stringify(aiReviewFailure(failure(401)))).not.toMatch(/private-provider-detail|secret-response|provider.invalid/)
})
it("reports timeouts separately from generic failures",()=>{
  expect(aiReviewFailure(Object.assign(new Error("private"),{name:"TimeoutError"})).code).toBe("AI_TIMEOUT")
  expect(aiReviewFailure(new Error("private"))).toMatchObject({status:503,code:"AI_UNAVAILABLE"})
})
