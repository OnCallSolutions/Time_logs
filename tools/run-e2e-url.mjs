/**
 * Runs Playwright against a supplied deployed app URL.
 *
 * This helper keeps URL validation and environment wiring out of package scripts.
 * It accepts the URL as the first argument or from TEST_TARGET_URL/MAIN_PAGE_URL.
 */
import { spawn } from "node:child_process"

const suppliedUrl =
  process.argv[2] ?? process.env.TEST_TARGET_URL ?? process.env.MAIN_PAGE_URL

/**
 * Validates that a value is an absolute HTTP(S) URL.
 *
 * @param {string | undefined} value - URL provided by the caller or environment.
 * @returns {string | null} Normalized URL string, or null when invalid.
 */
function normalizeUrl(value) {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Spawns Playwright with the target URL in the child environment.
 *
 * @param {string} url - Absolute app page URL to test.
 * @returns {void}
 */
function runPlaywright(url) {
  const command = resolvePnpmCommand(["exec", "playwright", "test"])
  const child = spawn(command.executable, command.args, {
    env: {
      ...process.env,
      TEST_TARGET_URL: url,
    },
    stdio: "inherit",
  })

  child.on("exit", (code) => {
    process.exit(code ?? 1)
  })
}

/**
 * Resolves pnpm execution across Windows and Unix-like shells.
 *
 * @param {string[]} args - pnpm arguments to run.
 * @returns {{ executable: string, args: string[] }} Spawn-ready command.
 */
function resolvePnpmCommand(args) {
  if (process.platform === "win32") {
    return { executable: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] }
  }

  return { executable: "pnpm", args }
}

const url = normalizeUrl(suppliedUrl)

if (!url) {
  console.error(
    "Provide a deployed app URL, for example: pnpm test:e2e:url https://example.vercel.app/tanovo-time",
  )
  process.exit(1)
}

runPlaywright(url)
