/**
 * Provides a no-op replacement for Next.js server-only markers during tests.
 *
 * Unit tests intentionally import server modules in a controlled Vitest process.
 * The production-only marker is still active in the app build, but tests do not
 * need it to throw while exercising pure authorization behavior.
 */
export {}
