/**
 * Smoke-tests the unauthenticated browser entry point.
 *
 * Deeper authenticated flows should be added with seeded test users once the app
 * has a dedicated test auth/database environment. TEST_TARGET_URL can point this
 * same test at a deployed main page URL instead of the local dev server.
 */
import { expect, test } from "@playwright/test"

const targetUrl = process.env.TEST_TARGET_URL ?? "/timelog"

test("shows the Microsoft sign-in entry point", async ({ page }) => {
  await page.goto(targetUrl)

  await expect(
    page.getByRole("heading", { name: /sign in to devoncall/i }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /sign in with microsoft/i }),
  ).toBeVisible()
})
