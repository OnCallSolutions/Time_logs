/**
 * Configures Vitest for unit and component tests.
 *
 * The suite runs in jsdom so React components can render with Testing Library,
 * while server-only imports are stubbed for isolated authorization tests. Coverage
 * excludes generated build output and end-to-end specs so reports stay focused on
 * app code that unit and component tests can exercise quickly.
 */
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      "server-only": resolve(
        import.meta.dirname,
        "tests/mocks/server-only.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: [
        ".next/**",
        "coverage/**",
        "e2e/**",
        "node_modules/**",
        "next-env.d.ts",
        "types/**",
        "vitest.config.mts",
        "playwright.config.ts",
      ],
    },
  },
})
