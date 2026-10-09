/**
 * Defines the root Next.js layout, metadata, fonts, and global analytics.
 *
 * This file is responsible for document-level concerns shared by every route:
 * SEO metadata, viewport theme colors, Google font variables, global styles, and
 * production-only Vercel Analytics.
 */
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { basePath } from '@/lib/paths'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'Tanovo Time | Contractor Hours & Manager Reports',
  description:
    'Tanovo Time turns contractor time notes into clear reports of hours worked for managers.',
  icons: {
    icon: `${basePath}/devoncall-favicon.ico`,
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#ffffff',
}

/**
 * Wraps every page with global fonts, body styles, and production analytics.
 *
 * The layout keeps page components focused on feature UI while centralizing the
 * HTML shell. Analytics is only rendered in production to keep local development
 * quieter and avoid unnecessary telemetry calls.
 *
 * @param props - Layout props.
 * @param props.children - Page content rendered inside the app shell.
 * @returns The root HTML document layout.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`light bg-background ${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased font-sans">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
