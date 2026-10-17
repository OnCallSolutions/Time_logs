/**
 * Defines bounded session remembrance independent of browser cookie restoration.
 * Idle time advances only through explicit activity, not background API polling.
 * An absolute lifetime always requires fresh Microsoft authentication afterward.
 */
export const SESSION_IDLE_SECONDS = 30 * 60
export const SESSION_MAX_SECONDS = 8 * 60 * 60
export const SESSION_WARNING_SECONDS = 2 * 60
export type AppSessionState = { expiresAt:string; absoluteExpiresAt:string }
/**
 * Computes expiration boundaries without trusting a client clock or timestamp.
 * @param created - Original successful sign-in timestamp in milliseconds.
 * @param active - Last accepted interactive activity timestamp in milliseconds.
 * @param now - Current server timestamp in milliseconds.
 * @returns boolean indicating strict idle and absolute validity.
 */
export function sessionIsActive(created:number,active:number,now=Date.now()):boolean{
  return Number.isFinite(created)&&Number.isFinite(active)&&created<=active&&active<=now&&now<created+SESSION_MAX_SECONDS*1000&&now<active+SESSION_IDLE_SECONDS*1000
}
