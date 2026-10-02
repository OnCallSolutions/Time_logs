import { handlers } from "@/auth"
import { NextRequest } from "next/server"

function withPublicAuthPath(req: NextRequest) {
  const url = req.nextUrl.clone()

  if (url.pathname.startsWith("/api/auth")) {
    url.pathname = `/timelog${url.pathname}`
  }
  return new NextRequest(url, req)
}

export function GET(req: NextRequest) {
  return handlers.GET(withPublicAuthPath(req))
}

export function POST(req: NextRequest) {
  return handlers.POST(withPublicAuthPath(req))
}
