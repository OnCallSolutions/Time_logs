/**
 * Configures PostCSS plugins used by Tailwind CSS.
 *
 * Tailwind v4 is loaded through the official PostCSS plugin so global CSS and
 * component utility classes are compiled during Next.js builds.
 */
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
