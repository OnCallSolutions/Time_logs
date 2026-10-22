/**
 * Exposes the NextAuth route handlers under the app's configured base path.
 *
 * NextAuth owns the GET and POST behavior for sign-in, callback, session, and
 * sign-out requests. Re-exporting the configured handlers keeps the route file
 * thin while preserving the /tanovo-time/api/auth path expected by Azure.
 */
import { handlers } from "@/auth"
import { stepUpHandlers } from "@/step-up-auth"
import { NextRequest } from "next/server"
import { basePath } from "@/lib/paths"

/**
 * Recreates an auth request with the public Next.js base path restored.
 *
 * Next.js strips /tanovo-time before invoking app route handlers, but Auth.js parses
 * actions relative to the configured public base path. Restoring the pathname
 * keeps local, preview, and Azure callback URLs aligned.
 *
 * @param req - Incoming route handler request from Next.js.
 * @returns A request whose URL pathname includes /tanovo-time before /api/auth.
 */
function withPublicAuthBasePath(req: NextRequest) {
  const url = new URL(req.url)

  if (url.pathname.startsWith("/api/auth")) {
    url.pathname = `${basePath}${url.pathname}`
  }

  return new NextRequest(url, {
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    headers: req.headers,
    method: req.method,
  })
}

/** Routes explicitly tagged step-up requests, and their OAuth callback, to isolated cookies. */
function isStepUpRequest(req:NextRequest):boolean{
  if(req.nextUrl.searchParams.get("stepup")==="1")return true
  return req.nextUrl.pathname.includes("/callback/")&&req.cookies.has("tanovo-time.stepup.state")
}

/** Logs only the selected callback flow and cookie presence, never cookie values. */
function logCallbackFlow(req:NextRequest,stepUp:boolean):void{
  if(!req.nextUrl.pathname.includes("/callback/"))return
  console.info("[auth-route] OAuth callback routed.",{
    flow:stepUp?"step-up":"primary",
    hasStepUpStateCookie:req.cookies.has("tanovo-time.stepup.state"),
  })
}

/**
 * Handles Auth.js GET requests after restoring the public base path.
 *
 * @param req - Incoming GET request for an auth action.
 * @returns The Auth.js response for the requested action.
 */
export function GET(req: NextRequest) {
  const stepUp=isStepUpRequest(req)
  logCallbackFlow(req,stepUp)
  return (stepUp?stepUpHandlers.GET:handlers.GET)(withPublicAuthBasePath(req))
}

/**
 * Handles Auth.js POST requests after restoring the public base path.
 *
 * @param req - Incoming POST request for an auth action.
 * @returns The Auth.js response for the requested action.
 */
export function POST(req: NextRequest) {
  const stepUp=isStepUpRequest(req)
  logCallbackFlow(req,stepUp)
  return (stepUp?stepUpHandlers.POST:handlers.POST)(withPublicAuthBasePath(req))
}
