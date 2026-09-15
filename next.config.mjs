/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/timer_logs",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
