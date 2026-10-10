/**
 * Reports Playwright inventory and live outcomes using its public reporter API.
 * Retries update the same case row; final flaky and expected outcomes stay distinct.
 * Browser setup failures are included even when no case can begin execution.
 */
import { caseRow, emit } from "./test-events.mjs";
export default class ConsoleReporter {
  rows = new Map();
  /** @param {object} config - Resolved runner configuration. @param {object} suite - Collected root suite. @returns {void} Seeds all browser cases. */
  onBegin(config, suite) {
    for (const test of suite.allTests()) {
      const row = caseRow({
        file: test.location.file,
        name: test.titlePath().filter(Boolean).join(" > "),
        kind: "browser",
        project: test.parent.project()?.name ?? "",
        state: "queued",
      });
      row.id = "browser:" + test.id;
      this.rows.set(test.id, { row, test });
      emit({ type: "case", row });
    }
  }
  /** @param {object} test - Starting browser case. @returns {void} Updates the running state. */
  onTestBegin(test) {
    emit({
      type: "case",
      row: {
        ...this.rows.get(test.id).row,
        state: "running",
        startedAt: new Date().toISOString(),
      },
    });
  }
  /** @param {object} test - Completed attempt. @param {object} result - Browser attempt result. @returns {void} Reports retry-aware duration and errors. */
  onTestEnd(test, result) {
    const record = this.rows.get(test.id);
    record.result = result;
    emit({
      type: "case",
      row: {
        ...record.row,
        state:
          result.status === "passed"
            ? "passed"
            : result.status === "skipped"
              ? "skipped"
              : "failed",
        duration: result.duration,
        attempt: result.retry + 1,
        errors: result.errors.map((error) => ({
          message: error.message ?? "Browser failure",
          stack: error.stack ?? "",
        })),
      },
    });
  }
  /** @param {object} error - Browser setup/collection error. @returns {void} Adds an actionable setup-failure row. */
  onError(error) {
    emit({
      type: "case",
      row: caseRow({
        file: "e2e/setup",
        name: error.message ?? "Browser setup failed",
        kind: "browser",
        state: "failed",
        errors: [{ message: error.message, stack: error.stack ?? "" }],
      }),
    });
  }
  /** @returns {void} Reports final expected/flaky/unexpected case outcomes. */
  onEnd() {
    for (const { row, test, result } of this.rows.values())
      if (result)
        emit({
          type: "case",
          row: {
            ...row,
            state:
              test.outcome() === "flaky"
                ? "flaky"
                : test.outcome() === "unexpected"
                  ? "failed"
                  : test.outcome() === "skipped"
                    ? "skipped"
                    : "passed",
            duration: result.duration,
            attempt: result.retry + 1,
            errors: result.errors.map((error) => ({
              message: error.message ?? "Browser failure",
              stack: error.stack ?? "",
            })),
          },
        });
  }
}
