import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  const pathname = new URL(request.url).pathname

  if (pathname === "/timelog" || pathname.startsWith("/timelog/")) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL("/timelog", request.url))
}

export const config = {
  matcher: "/",
}
