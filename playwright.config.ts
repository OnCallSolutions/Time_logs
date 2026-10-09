/**
 * Configures Playwright for browser-level regression tests.
 *
 * Local runs start the Next dev server and visit /tanovo-time. Remote runs can set
 * TEST_TARGET_URL to a full deployed page URL, which skips the local server and
 * lets the same smoke tests validate Vercel previews or production URLs.
 */
import { defineConfig, devices } from "@playwright/test"

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
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: usesRemoteTarget
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://127.0.0.1:3000/tanovo-time",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
