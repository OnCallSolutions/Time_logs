/**
 * Configures Next.js base path, image behavior, and build-time TypeScript handling.
 *
 * The app is served below /timelog, so auth routes, API paths, and client
 * fetches must account for that base path. Image optimization is disabled because
 * the project uses static placeholder assets and Vercel preview compatibility is
 * more important than remote optimization here.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/timelog",
  async redirects() {
    return [
      {
        /**
         * Redirects plain localhost/domain visits into the configured app base path.
         *
         * Next.js normally prefixes redirect sources with basePath, so basePath=false
         * is required here to match the real site root at "/" before users reach the
         * app mounted at /timelog.
         */
        source: "/",
        destination: "/timelog",
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
