/**
 * Maps AI-provider failures to actionable public errors without exposing secrets.
 * Raw provider bodies, request URLs, credentials, and prompts are never returned.
 * Manual decisions remain available during model-service outages.
 */
import { APICallError,LoadAPIKeyError } from "ai"
/**
 * Classifies recognized SDK and timeout errors using safe metadata only.
 * @param error - Internal model-call failure, never serialized to clients.
 * @returns Public status, stable code, and a credential-free explanation.
 */
export function aiReviewFailure(error:unknown):{status:number;code:string;error:string}{
  if(LoadAPIKeyError.isInstance(error)||(APICallError.isInstance(error)&&[401,403].includes(error.statusCode??0)))return {status:503,code:"AI_CONFIGURATION",error:"The AI service could not authenticate. Ask an administrator to check the AI Gateway configuration. Microsoft sign-in is separate; manual review remains available."}
  if(APICallError.isInstance(error)&&error.statusCode===429)return {status:429,code:"AI_RATE_LIMIT",error:"The AI service is temporarily rate-limited. Wait before trying again; manual review remains available."}
  if(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name))return {status:504,code:"AI_TIMEOUT",error:"AI analysis timed out. Try a smaller selection; no decisions were saved."}
  return {status:503,code:"AI_UNAVAILABLE",error:"AI review unavailable. Manual review remains available."}
}
