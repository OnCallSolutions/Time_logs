/**
 * Collects the real Vitest test tree without executing test callbacks or hooks.
 * Vitest 5 static listing cannot expand parameterized cases, so collection uses
 * the documented non-static API and the same event/identity model as live runs.
 */
import { createVitest } from "vitest/node";
import ConsoleReporter from "./vitest-console-reporter.mjs";
const context = await createVitest("test", { watch: false, reporters: [] });
try {
  const result = await context.collect([], { staticParse: false });
  const reporter = new ConsoleReporter();
  for (const module of result.testModules)
    reporter.onTestModuleCollected(module);
  reporter.onTestRunEnd(result.testModules, result.unhandledErrors);
  if (
    result.unhandledErrors.length ||
    result.testModules.some((module) => module.errors().length)
  )
    process.exitCode = 1;
} finally {
  await context.close();
}
