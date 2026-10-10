/**
 * Defines structured test-console events and stable case identities.
 * Categories describe test layers; areas describe the application responsibility.
 * Duplicate parameterized names retain separate rows through occurrence indices.
 */
import { createHash } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
export const EVENT_PREFIX = "@@ONCALL_TEST@@";
const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Normalizes a runner path relative to the current checkout.
 * @param {string} file - Absolute or checkout-relative test path.
 * @returns {string} Portable forward-slash path.
 */
export function testFile(file) {
  return (isAbsolute(file) ? relative(root, file) : file).replaceAll("\\", "/");
}

/**
 * Categorizes a case by its layer and feature ownership without a hard-coded list.
 * @param {string} file - Test source path.
 * @param {string} kind - Runner kind: unit, browser, or check.
 * @returns {{category:string,area:string}} Stable filter labels.
 */
export function categorize(file, kind = "unit") {
  const path = testFile(file).toLowerCase();
  const category =
    kind === "browser"
      ? "Browser"
      : kind === "check"
        ? "Checks"
        : path.startsWith("app/api/")
          ? "API"
          : path.startsWith("components/") || path.startsWith("app/")
            ? "UI"
            : "Unit";
  const area = /message|collaboration/.test(path)
    ? "Messaging"
    : /admin|users|delegation|permission|access|role-navigation/.test(path)
      ? "Access & roles"
      : /security|audit/.test(path)
        ? "Security"
        : /auth|sign-in|page\.test/.test(path)
          ? "Authentication"
          : /review|manager|employee|entries|timesheet|note/.test(path)
            ? "Timesheets"
            : /tools|test-events/.test(path)
              ? "Test framework"
              : "General";
  return { category, area };
}

/**
 * Constructs a portable case row whose identity survives inventory/run transitions.
 * @param {{file:string,name:string,kind?:string,project?:string,occurrence?:number,state?:string}} input - Case metadata.
 * @returns {Record<string,unknown>} Inventory or result row.
 */
export function caseRow({
  file,
  name,
  kind = "unit",
  project = "",
  occurrence = 0,
  state = "not_run",
  ...extra
}) {
  const normalized = testFile(file);
  const id = createHash("sha256")
    .update(
      JSON.stringify([kind, normalized, name.trim(), project, occurrence]),
    )
    .digest("hex")
    .slice(0, 24);
  return {
    id,
    file: normalized,
    name: name.trim(),
    kind,
    project,
    occurrence,
    ...categorize(normalized, kind),
    state,
    duration: null,
    errors: [],
    ...extra,
  };
}

/**
 * Emits a framed JSON event for the console, independently of runner formatting.
 * @param {Record<string,unknown>} payload - Collected case or lifecycle result.
 * @returns {void} Writes exactly one structured protocol line.
 */
export function emit(payload) {
  process.stdout.write(EVENT_PREFIX + JSON.stringify(payload) + "\n");
}

/**
 * Separates structured protocol lines from ordinary command output across chunks.
 * @param {(value:object)=>void} onEvent - Structured-event consumer.
 * @param {(text:string)=>void} onLog - Terminal-output consumer.
 * @returns {{write:(chunk:string)=>void,flush:()=>void}} Chunk-safe parser.
 */
export function eventParser(onEvent, onLog) {
  let buffer = "";
  /** @param {string} line - Complete output line. @returns {void} Routes protocol or log text. */
  function consume(line) {
    if (line.startsWith(EVENT_PREFIX)) {
      try {
        onEvent(JSON.parse(line.slice(EVENT_PREFIX.length)));
        return;
      } catch {}
    }
    onLog(line + "\n");
  }
  return {
    write(chunk) {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
    },
    flush() {
      if (buffer) consume(buffer);
      buffer = "";
    },
  };
}
