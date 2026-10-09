/**
 * Configures Playwright for browser-level regression tests.
 *
 * Local runs start the Next dev server and visit /tanovo-time. Remote runs can set
 * TEST_TARGET_URL to a full deployed page URL, which skips the local server and
 * lets the same smoke tests validate Vercel previews or production URLs.
 */
import { defineConfig, devices } from "@playwright/test"
import { basePath } from "./lib/paths"

const targetUrl = process.env.TEST_TARGET_URL ?? "/tanovo-time"
const usesRemoteTarget = /^https?:\/\//i.test(targetUrl)

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: usesRemoteTarget
    ? undefined
    : {
        command: "pnpm dev --port 3100 --hostname localhost",
        url: `http://localhost:3100${basePath}`,
        reuseExistingServer: false,
        env: {
          APP_E2E_SERVER: "1",
          AUTH_URL: "http://localhost:3100",
          NEXTAUTH_URL: "http://localhost:3100",
        },
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
