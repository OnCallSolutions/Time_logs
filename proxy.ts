import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  const pathname = new URL(request.url).pathname

  if (pathname === "/tanonvo-time" || pathname.startsWith("/tanonvo-time/")) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL("/tanonvo-time", request.url))
}

export const config = {
  matcher: "/",
}
