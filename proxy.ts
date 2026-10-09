/**
 * Redirects bare-root requests into the /tanovotime application base path.
 *
 * The Next.js basePath handles normal app routing, while this proxy provides a
 * lightweight server-side guard for direct root visits in environments where the
 * config redirect may not have run yet.
 */
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { basePath } from "@/lib/paths"

/**
 * Allows /tanovotime requests and redirects every matched root request to /tanovotime.
 *
 * @param request - Incoming request inspected before route rendering.
 * @returns Next response that continues or redirects to the app base path.
 */
export function proxy(request: NextRequest) {
  const pathname = new URL(request.url).pathname

  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL(basePath, request.url))
}

/**
 * Limits the proxy to the root path so app assets and API routes are untouched.
 */
export const config = {
  matcher: "/",
}
