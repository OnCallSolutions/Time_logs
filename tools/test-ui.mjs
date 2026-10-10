/**
 * Serves a loopback-only console independent of the Next.js application.
 * Discovers actual cases and streams structured outcomes into a compact table.
 * Fixed commands run on the current checkout without changing Git branches.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Play,
  ShieldCheck,
  ChartNoAxesCombined,
  RefreshCw,
  Logs,
  Download,
  Globe,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { caseRow, eventParser } from "./test-events.mjs";
import { explainTest } from "./test-explanations.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  require = createRequire(import.meta.url);
const local = (file) => fileURLToPath(new URL(file, import.meta.url));
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const playwright = require.resolve("@playwright/test/cli"),
  tsc = require.resolve("typescript/bin/tsc"),
  next = require.resolve("next/dist/bin/next");
const icons = {
  play: Play,
  verify: ShieldCheck,
  coverage: ChartNoAxesCombined,
  refresh: RefreshCw,
  logs: Logs,
  download: Download,
  browser: Globe,
  back: ArrowLeft,
  view: Eye,
};

/** @returns {object} Current source branch and local branches, without modifying Git. */
export function branchState() {
  const git = (args) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim() ?? "";
  return {
    currentBranch: git(["branch", "--show-current"]) || "detached",
    branches: git(["branch", "--format=%(refname:short)"])
      .split(/\r?\n/)
      .filter(Boolean),
  };
}
/** @param {string} value - Target page. @returns {string|null} Credential-free HTTP URL. */
export function normalizeTarget(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
/**
 * Resolves allowlisted actions into direct Node arguments, never shell strings.
 * @param {object} input - Action and browser target.
 * @returns {object[]|null} Ordered stages or invalid-action sentinel.
 */
export function actionSteps(input) {
  const unit = {
    label: "Unit, API, and UI tests",
    kind: "unit",
    args: [vitest, "run", "--reporter=" + local("vitest-console-reporter.mjs")],
  };
  if (input.action === "unit") return [unit];
  if (input.action === "coverage")
    return [{ ...unit, args: [...unit.args, "--coverage"] }];
  if (input.action === "verify")
    return [
      { label: "TypeScript", kind: "check", args: [tsc, "--noEmit"] },
      unit,
      { label: "Production build", kind: "check", args: [next, "build"] },
    ];
  if (input.action === "install")
    return [
      {
        label: "Install Chromium",
        kind: "check",
        args: [playwright, "install", "chromium"],
      },
    ];
  if (["e2e-local", "e2e-url"].includes(input.action)) {
    const target = normalizeTarget(
      input.action === "e2e-local" ? input.localUrl : input.targetUrl,
    );
    if (!target) return null;
    if (
      input.action === "e2e-local" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname)
    )
      return null;
    return [
      {
        label: "Browser tests",
        kind: "browser",
        args: [
          playwright,
          "test",
          "--reporter=" + local("playwright-console-reporter.mjs"),
        ],
        env: { TEST_TARGET_URL: target },
      },
    ];
  }
  return null;
}
/**
 * Runs a direct Node child, separating reporter events from terminal output.
 * @param {string[]} args - CLI arguments. @param {object} env - Scoped environment additions.
 * @param {Function} onEvent - Event consumer. @param {Function} onLog - Output consumer.
 * @returns {Promise<number>} Actual process exit status.
 */
export function execute(args, env = {}, onEvent = () => {}, onLog = () => {}) {
  return new Promise((done) => {
    const parser = eventParser(onEvent, onLog),
      child = spawn(process.execPath, args, {
        cwd: root,
        env: { ...process.env, ...env },
        windowsHide: true,
      });
    child.stdout.on("data", (chunk) => parser.write(chunk.toString()));
    child.stderr.on("data", (chunk) => onLog(chunk.toString()));
    child.on("error", (error) => onLog(error.message + "\n"));
    child.on("close", (code) => {
      parser.flush();
      done(code ?? 1);
    });
  });
}
/** @returns {Promise<object>} Collects runnable cases without executing test callbacks. */
export async function discover() {
  const rows = new Map(),
    errors = [];
  const event = (value) => {
    if (value.type === "case")
      rows.set(value.row.id, { ...value.row, state: "not_run" });
    if (value.type === "error") errors.push(JSON.stringify(value));
  };
  for (const args of [
    [local("collect-console-tests.mjs")],
    [
      playwright,
      "test",
      "--list",
      "--reporter=" + local("playwright-console-reporter.mjs"),
    ],
  ]) {
    let output = "";
    const code = await execute(args, {}, event, (text) => {
      output += text;
    });
    if (code) errors.push(output || "Runner discovery failed");
  }
  for (const name of ["TypeScript", "Production build"]) {
    const row = caseRow({ file: "", name, kind: "check" });
    rows.set(row.id, row);
  }
  return { rows: [...rows.values()], errors };
}
/** @param {object} response - HTTP response. @param {unknown} data - Payload. @param {number} code - Status. @returns {void} Sends JSON. */
function json(response, data, code = 200) {
  response.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}
/** @param {object} request - Incoming request. @returns {Promise<object>} Bounded parsed JSON. */
async function body(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 131072) throw new Error("Request too large");
  }
  return JSON.parse(text || "{}");
}

/**
 * Creates an injectable local server with no import-time listener.
 * @param {object} options - Discovery, executor, and watch overrides for tests.
 * @returns {import('node:http').Server} Unbound HTTP server.
 */
export function createTestConsole({
  discoverTests = discover,
  executeStep = execute,
  watchFiles = true,
} = {}) {
  const runs = new Map(),
    watchers = [];
  let cached = null,
    cacheBranch = "",
    dirty = true,
    starting = false;
  if (watchFiles)
    for (const directory of [
      "app",
      "components",
      "lib",
      "tests",
      "e2e",
      "tools",
    ]) {
      try {
        watchers.push(
          watch(join(root, directory), { recursive: true }, () => {
            dirty = true;
          }),
        );
      } catch {}
    }
  /** @param {boolean} refresh - Force collection. @returns {Promise<object>} Branch-scoped inventory. */
  async function catalog(refresh = false) {
    const branch = branchState().currentBranch;
    if (refresh || dirty || !cached || cacheBranch !== branch) {
      cached = await discoverTests();
      cacheBranch = branch;
      dirty = false;
    }
    return cached;
  }
  /** @param {object} run - Run record. @returns {object} Snapshot without process environment or clients. */
  function snapshot(run) {
    return { ...run, rows: [...run.rows.values()], clients: undefined };
  }
  /** @param {object} run - Run. @param {string} type - Event. @param {unknown} value - Payload. @returns {void} Broadcasts an event. */
  function publish(run, type, value) {
    for (const client of run.clients)
      client.write(
        "event: " + type + "\ndata: " + JSON.stringify(value) + "\n\n",
      );
  }
  /** @param {object} run - Run. @param {string} text - Output. @returns {void} Stores bounded logs. */
  function log(run, text) {
    run.logs = (run.logs + text).slice(-1000000);
    publish(run, "log", { text });
  }
  /** @param {object} run - Run. @param {object} row - Case. @returns {void} Updates one table row. */
  function update(run, row) {
    run.rows.set(row.id, { ...run.rows.get(row.id), ...row });
    publish(run, "case", run.rows.get(row.id));
  }
  /** @param {object} run - Run. @param {object[]} steps - Stages. @returns {Promise<void>} Completes stages and result streams. */
  async function perform(run, steps) {
    let code = 0;
    try {
      for (const step of steps) {
        publish(run, "stage", { label: step.label });
        const start = Date.now(),
          check = caseRow({ file: "", name: step.label, kind: "check" });
        if (step.kind === "check")
          update(run, {
            ...check,
            state: "running",
            startedAt: new Date().toISOString(),
          });
        code = await executeStep(
          step.args,
          step.env ?? {},
          (event) => {
            if (event.type === "case") update(run, event.row);
            else if (event.type === "error")
              log(run, JSON.stringify(event) + "\n");
          },
          (text) => log(run, text),
        );
        if (
          step.kind !== "check" &&
          code === 0 &&
          [...run.rows.values()].some(
            (row) =>
              row.kind === step.kind &&
              ["queued", "running"].includes(row.state),
          )
        ) {
          code = 1;
          log(run, "Runner did not report every discovered outcome.\n");
        }
        if (step.kind === "check" || code)
          update(run, {
            ...check,
            state: code ? "failed" : "passed",
            duration: Date.now() - start,
            finishedAt: new Date().toISOString(),
          });
        if (code) break;
      }
    } catch (error) {
      code = 1;
      log(run, error.stack || error.message);
    }
    for (const row of run.rows.values())
      if (["queued", "running"].includes(row.state))
        update(run, { ...row, state: "not_run" });
    run.exitCode = code;
    run.status = code ? "failed" : "passed";
    run.finishedAt = new Date().toISOString();
    publish(run, "done", snapshot(run));
    for (const client of run.clients) client.end();
    run.clients.clear();
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://" + request.headers.host);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return json(response, { error: "Loopback host required" }, 403);
      if (
        request.method === "POST" &&
        request.headers.origin &&
        request.headers.origin !== url.origin
      )
        return json(response, { error: "Cross-origin commands blocked" }, 403);
      if (url.pathname === "/api/state")
        return json(response, {
          ...branchState(),
          runs: [...runs.values()].map(({ id, label, status, startedAt }) => ({
            id,
            label,
            status,
            startedAt,
          })),
          defaultTargetUrl: "",
        });
      if (url.pathname === "/api/tests")
        return json(
          response,
          await catalog(url.searchParams.get("refresh") === "1"),
        );
      if (url.pathname === "/api/test-details" && request.method === "GET") {
        const runId = url.searchParams.get("runId");
        const run = runId ? runs.get(runId) : null;
        if (runId && !run)
          return json(response, { error: "Run not found" }, 404);
        if (run && run.branch !== branchState().currentBranch)
          return json(
            response,
            {
              error:
                "Source branch changed; return to current inventory for setup details",
            },
            409,
          );
        const inventory = run ? [...run.rows.values()] : (await catalog()).rows;
        const row = inventory.find(
          (item) => item.id === url.searchParams.get("id"),
        );
        if (!row) return json(response, { error: "Test not found" }, 404);
        return json(response, {
          ...explainTest(row),
          source: "Current checkout: " + branchState().currentBranch,
        });
      }
      if (url.pathname === "/api/run" && request.method === "POST") {
        if (
          starting ||
          [...runs.values()].some((run) => run.status === "running")
        )
          return json(response, { error: "A run is already active" }, 409);
        const input = await body(request),
          steps = actionSteps(input);
        if (!steps)
          return json(
            response,
            { error: "Invalid command or target URL" },
            400,
          );
        if (
          starting ||
          [...runs.values()].some((run) => run.status === "running")
        )
          return json(
            response,
            { error: "A run is already starting or active" },
            409,
          );
        starting = true;
        try {
          const branch = branchState().currentBranch,
            inventory = await catalog();
          if (branchState().currentBranch !== branch)
            return json(
              response,
              { error: "Source branch changed; refresh and retry" },
              409,
            );
          if (inventory.errors.length)
            return json(response, { error: inventory.errors.join("\n") }, 400);
          const kinds = new Set(steps.map((step) => step.kind)),
            id = randomUUID();
          const run = {
            id,
            label: input.action,
            branch,
            targetUrl: steps[0].env?.TEST_TARGET_URL,
            startedAt: new Date().toISOString(),
            status: "running",
            rows: new Map(
              inventory.rows.map((row) => [
                row.id,
                { ...row, state: kinds.has(row.kind) ? "queued" : "not_run" },
              ]),
            ),
            logs: "",
            clients: new Set(),
          };
          runs.set(id, run);
          while (runs.size > 10) runs.delete(runs.keys().next().value);
          json(response, { runId: id });
          void perform(run, steps);
        } finally {
          starting = false;
        }
        return;
      }
      if (["/api/events", "/api/results"].includes(url.pathname)) {
        const run = runs.get(url.searchParams.get("runId"));
        if (!run) return json(response, { error: "Run not found" }, 404);
        if (url.pathname === "/api/results")
          return json(response, snapshot(run));
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        response.write(
          "event: snapshot\ndata: " + JSON.stringify(snapshot(run)) + "\n\n",
        );
        if (run.status !== "running") {
          response.end(
            "event: done\ndata: " + JSON.stringify(snapshot(run)) + "\n\n",
          );
          return;
        }
        run.clients.add(response);
        const heartbeat = setInterval(
          () => response.write(": heartbeat\n\n"),
          15000,
        );
        response.on("close", () => {
          clearInterval(heartbeat);
          run.clients.delete(response);
        });
        return;
      }
      if (request.method !== "GET")
        return json(response, { error: "Not found" }, 404);
      const file = {
        "/": "test-console.html",
        "/test-console.css": "test-console.css",
        "/test-console.js": "test-console.js",
      }[url.pathname];
      if (!file) return json(response, { error: "Not found" }, 404);
      let content = readFileSync(local(file), "utf8");
      if (file.endsWith("html"))
        content = content.replace(/\{\{(\w+)\}\}/g, (_, name) =>
          icons[name]
            ? renderToStaticMarkup(
                React.createElement(icons[name], {
                  size: 16,
                  "aria-hidden": true,
                }),
              )
            : "",
        );
      response.writeHead(200, {
        "Content-Type": file.endsWith("html")
          ? "text/html"
          : file.endsWith("css")
            ? "text/css"
            : "text/javascript",
      });
      response.end(content);
    } catch (error) {
      json(response, { error: error.message }, 400);
    }
  });
  server.on("close", () => {
    for (const watcher of watchers) watcher.close();
  });
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.TEST_UI_PORT ?? 4317);
  createTestConsole().listen(port, "127.0.0.1", () =>
    console.log("Test console: http://127.0.0.1:" + port),
  );
}
