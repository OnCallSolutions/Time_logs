/**
 * Defines base-path helpers for routes served under /tanovo-time.
 *
 * Next.js is configured with a base path, so client-side fetches need the same
 * prefix to work locally and on Vercel. Keeping the prefix in one helper avoids
 * scattered hardcoded route strings.
 */
export const basePath = "/tanovo-time"

/**
 * Prefixes app API routes with the configured Next.js base path.
 *
 * Route callers pass the natural app path, such as /api/entries, and receive the
 * deployed path that includes /tanovo-time. The template type requires a leading
 * slash so accidental relative paths fail at compile time.
 *
 * @param path - App-relative API path beginning with a slash.
 * @returns The full base-path-prefixed API path.
 */
export function apiPath(path: `/${string}`) {
  return `${basePath}${path}`
}
