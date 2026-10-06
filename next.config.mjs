/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/tanonvo-time",
  async redirects() {
    return [
      {
        source: "/tanonvo-time/tanonvo-time/:path*",
        destination: "/tanonvo-time/:path*",
        permanent: false,
        basePath: false,
      },
      {
        source: "/",
        destination: "/tanonvo-time",
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
