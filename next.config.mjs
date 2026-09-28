/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/timelog",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
