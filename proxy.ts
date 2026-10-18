/**
 * Redirects bare-root requests into the /tanovo-time application base path.
 *
 * The Next.js basePath handles normal app routing, while this proxy provides a
 * lightweight server-side guard for direct root visits in environments where the
 * config redirect may not have run yet.
 */
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { basePath } from "@/lib/paths"

/**
 * Allows /tanovo-time requests and redirects every matched root request to /tanovo-time.
 *
 * @param request - Incoming request inspected before route rendering.
 * @returns Next response that continues or redirects to the app base path.
 */
export function proxy(request: NextRequest) {
  const pathname = new URL(request.url).pathname

  if (pathname === "/") return NextResponse.redirect(new URL(basePath, request.url))
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return NextResponse.next()

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const isDev = process.env.NODE_ENV === "development"
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://vitals.vercel-insights.com https://*.vercel-insights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", policy)
  return response
}

/**
 * Limits the proxy to the root path so app assets and API routes are untouched.
 */
export const config = {
  matcher: "/:path*",
}
