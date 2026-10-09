/**
 * Guards the Tanovo Time public route prefix across configuration and clients.
 * The scheduled monitor and auth URLs must share the same base path.
 * These checks catch partial rebrands before deployment and Microsoft sign-in.
 */
import { expect, it } from "vitest"
import nextConfig from "../next.config.mjs"
import vercelConfig from "../vercel.json"
import packageInfo from "../package.json"
import { apiPath, basePath } from "./paths"

it("keeps Next.js, API, authentication, and scheduled security paths aligned", () => {
  expect(packageInfo.name).toBe("tanovo-time")
  expect(basePath).toBe("/tanovo-time")
  expect(nextConfig.basePath).toBe(basePath)
  expect(apiPath("/api/auth")).toBe("/tanovo-time/api/auth")
  expect(apiPath("/api/entries")).toBe("/tanovo-time/api/entries")
  expect(vercelConfig.crons[0].path).toBe(apiPath("/api/security") + "?scheduled=1")
})

it("redirects root and duplicated prefixes to the canonical product path", async () => {
  const redirects = await nextConfig.redirects?.()
  expect(redirects).toEqual(expect.arrayContaining([
    expect.objectContaining({source:"/",destination:basePath,basePath:false}),
    expect.objectContaining({source:basePath+basePath+"/:path*",destination:basePath+"/:path*",basePath:false}),
  ]))
})
