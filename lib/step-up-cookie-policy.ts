/** Returns secure cookie policies for Auth.js step-up authentication. */
export function stepUpCookiePolicies(secure:boolean){
  const standard={httpOnly:true,sameSite:"lax" as const,path:"/" as const,secure}
  return {
    standard,
    oauth:{...standard,sameSite:secure?"none" as const:"lax" as const},
  }
}
