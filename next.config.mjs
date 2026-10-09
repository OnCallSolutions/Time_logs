/**
 * Configures Next.js base path, image behavior, and build-time TypeScript handling.
 *
 * The app is served below /tanovotime, so auth routes, API paths, and client
 * fetches must account for that base path. Image optimization is disabled because
 * the project uses static placeholder assets and Vercel preview compatibility is
 * more important than remote optimization here.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  basePath: "/tanovotime",
  async redirects() {
    return [
      {
        /**
         * Collapses accidental duplicated base paths back to the canonical app URL.
         *
         * Auth callbacks and manual testing can occasionally produce
         * /tanovotime/tanovotime when base-path variables are misconfigured. This redirect
         * normalizes those requests without touching valid /tanovotime routes.
         */
        source: "/tanovotime/tanovotime/:path*",
        destination: "/tanovotime/:path*",
        basePath: false,
        permanent: false,
      },
      {
        /**
         * Redirects plain localhost/domain visits into the configured app base path.
         *
         * Next.js normally prefixes redirect sources with basePath, so basePath=false
         * is required here to match the real site root at "/" before users reach the
         * app mounted at /tanovotime.
         */
        source: "/",
        destination: "/tanovotime",
        basePath: false,
        permanent: false,
      },
    ]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
