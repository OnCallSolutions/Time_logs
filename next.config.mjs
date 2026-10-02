/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/timelog",
  async redirects() {
    return [
      {
        source: "/timelog/timelog/:path*",
        destination: "/timelog/:path*",
        permanent: false,
        basePath: false,
      },
      {
        source: "/",
        destination: "/timelog",
        permanent: false,
        basePath: false,
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
