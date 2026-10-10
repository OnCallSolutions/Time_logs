/**
 * Streams official Vitest case lifecycle events into the standalone test console.
 * It reports individual outcomes, durations, and suite/collection failures.
 * Terminal text is not parsed to guess which tests passed or failed.
 */
import { caseRow, emit } from "./test-events.mjs";
export default class ConsoleReporter {
  rows = new Map();
  /** @param {import("vitest/node").TestModule} module - Collected module. @returns {void} Seeds queued rows, including parameterized duplicates. */
  onTestModuleCollected(module) {
    const occurrences = new Map();
    for (const test of module.children.allTests()) {
      const name = test.fullName;
      const count = occurrences.get(name) ?? 0;
      occurrences.set(name, count + 1);
      const row = caseRow({
        file: module.moduleId,
        name,
        project: test.project.name ?? "",
        occurrence: count,
        state: "queued",
      });
      this.rows.set(test.id, row);
      emit({ type: "case", row });
    }
  }
  /** @param {import("vitest/node").TestCase} test - Starting test. @returns {void} Updates its running state. */
  onTestCaseReady(test) {
    const row = this.rows.get(test.id);
    if (row)
      emit({
        type: "case",
        row: { ...row, state: "running", startedAt: new Date().toISOString() },
      });
  }
  /** @param {import("vitest/node").TestCase} test - Completed test. @returns {void} Sends the actual result and diagnostics. */
  onTestCaseResult(test) {
    const row = this.rows.get(test.id);
    if (!row) return;
    const result = test.result();
    emit({
      type: "case",
      row: {
        ...row,
        state: result.state,
        duration: test.diagnostic()?.duration ?? null,
        errors: (result.errors ?? []).map((error) => ({
          message: error.message ?? String(error),
          stack: error.stack ?? "",
        })),
        finishedAt: new Date().toISOString(),
      },
    });
  }
  /** @param {import("vitest/node").TestModule[]} modules - Finished modules. @param {Error[]} errors - Unhandled runner errors. @returns {void} Adds visible collection failures without claiming cases passed. */
  onTestRunEnd(modules, errors) {
    for (const module of modules) {
      const failures = module.errors();
      if (failures.length)
        emit({
          type: "case",
          row: caseRow({
            file: module.moduleId,
            name: "Module collection / hooks",
            state: "failed",
            errors: failures.map((error) => ({
              message: error.message,
              stack: error.stack ?? "",
            })),
          }),
        });
    }
    for (const [index, error] of errors.entries())
      emit({
        type: "case",
        row: caseRow({
          file: "tools/vitest-runner",
          name: `Unhandled runner error ${index + 1}`,
          kind: "check",
          state: "failed",
          errors: [{ message: error.message, stack: error.stack ?? "" }],
        }),
      });
  }
}
