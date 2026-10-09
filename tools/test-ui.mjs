/**
 * Serves the standalone ONCALL testing dashboard.
 *
 * This Node server is intentionally outside the Next.js application. It exposes a
 * small local web UI with buttons and event listeners for running the shared test
 * framework against the current checkout, local app, or any deployed branch URL.
 */
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { URL } from "node:url"

const port = Number(process.env.TEST_UI_PORT ?? 4317)
const host = process.env.TEST_UI_HOST ?? "127.0.0.1"
const runs = new Map()

/**
 * Reads a JSON request body.
 *
 * @param {import("node:http").IncomingMessage} request - Incoming HTTP request.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON body, or an empty object.
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}

/**
 * Sends a JSON response.
 *
 * @param {import("node:http").ServerResponse} response - HTTP response object.
 * @param {unknown} payload - JSON payload to send.
 * @param {number} status - HTTP status code.
 * @returns {void}
 */
function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(payload))
}

/**
 * Runs a shell command and stores streamed output for dashboard clients.
 *
 * @param {string} label - Human-readable run label.
 * @param {string} executable - Command executable.
 * @param {string[]} args - Command arguments.
 * @param {NodeJS.ProcessEnv} env - Environment variables for the child process.
 * @returns {string} Created run id.
 */
function startRun(label, executable, args, env = process.env) {
  const id = randomUUID()
  const run = {
    id,
    label,
    command: [executable, ...args].join(" "),
    status: "running",
    exitCode: null,
    logs: [],
    clients: new Set(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  runs.set(id, run)

  pushLog(run, "system", `> ${run.command}\n`)

  const command = resolveCommand(executable, args)
  const child = spawn(command.executable, command.args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout.on("data", (chunk) => pushLog(run, "stdout", chunk.toString()))
  child.stderr.on("data", (chunk) => pushLog(run, "stderr", chunk.toString()))
  child.on("exit", (code) => {
    run.status = code === 0 ? "passed" : "failed"
    run.exitCode = code ?? 1
    run.finishedAt = new Date().toISOString()
    pushLog(run, "system", `\n${run.status.toUpperCase()} (${run.exitCode})\n`)
    broadcast(run, "done", {
      status: run.status,
      exitCode: run.exitCode,
      finishedAt: run.finishedAt,
    })
    for (const client of run.clients) {
      client.end()
    }
    run.clients.clear()
  })

  return id
}

/**
 * Adds one output chunk to a run and broadcasts it.
 *
 * @param {Record<string, unknown>} run - Stored run state.
 * @param {string} stream - Output stream name.
 * @param {string} text - Output text.
 * @returns {void}
 */
function pushLog(run, stream, text) {
  const entry = { stream, text, at: new Date().toISOString() }
  run.logs.push(entry)
  broadcast(run, "log", entry)
}

/**
 * Broadcasts a server-sent event to every connected client for a run.
 *
 * @param {Record<string, unknown>} run - Stored run state.
 * @param {string} event - Event name.
 * @param {unknown} payload - Event payload.
 * @returns {void}
 */
function broadcast(run, event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of run.clients) {
    client.write(frame)
  }
}

/**
 * Returns current Git branch and local branch names.
 *
 * @returns {{ currentBranch: string, branches: string[] }} Branch metadata.
 */
function getBranchState() {
  const current = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  })
  const branches = spawnSync("git", ["branch", "--format=%(refname:short)"], {
    encoding: "utf8",
  })

  return {
    currentBranch: current.stdout.trim() || "unknown",
    branches: branches.stdout
      .split(/\r?\n/)
      .map((branch) => branch.trim())
      .filter(Boolean),
  }
}

/**
 * Resolves command shims across Windows and Unix-like terminals.
 *
 * @param {string} executable - Portable command name.
 * @returns {string} Platform-specific executable name.
 */
function resolveCommand(executable, args) {
  if (process.platform === "win32" && executable === "pnpm") {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm", ...args],
    }
  }

  return { executable, args }
}

/**
 * Validates an absolute HTTP(S) URL for deployed branch testing.
 *
 * @param {unknown} value - Candidate URL from the dashboard.
 * @returns {string | null} Normalized URL, or null when invalid.
 */
function normalizeHttpUrl(value) {
  if (typeof value !== "string") return null

  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Maps a dashboard action to a command.
 *
 * @param {Record<string, unknown>} body - Request body from the dashboard.
 * @returns {{ label: string, executable: string, args: string[], env?: NodeJS.ProcessEnv } | null} Command spec.
 */
function commandForAction(body) {
  if (body.action === "verify") {
    return { label: "Full local verification", executable: "pnpm", args: ["verify"] }
  }
  if (body.action === "unit") {
    return { label: "Unit and component tests", executable: "pnpm", args: ["test"] }
  }
  if (body.action === "coverage") {
    return {
      label: "Coverage report",
      executable: "pnpm",
      args: ["test:coverage"],
    }
  }
  if (body.action === "e2e-local") {
    return {
      label: "Local browser smoke test",
      executable: "pnpm",
      args: ["test:e2e"],
    }
  }
  if (body.action === "install") {
    return {
      label: "Install Playwright Chromium",
      executable: "pnpm",
      args: ["test:install"],
    }
  }
  if (body.action === "e2e-url") {
    const targetUrl = normalizeHttpUrl(body.targetUrl)
    if (!targetUrl) return null
    return {
      label: `Deployed browser smoke test: ${targetUrl}`,
      executable: "pnpm",
      args: ["test:e2e:url"],
      env: {
        ...process.env,
        TEST_TARGET_URL: targetUrl,
      },
    }
  }

  return null
}

/**
 * Serves the dashboard HTML.
 *
 * @returns {string} HTML document with dynamic event-listener UI.
 */
function renderDashboard() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ONCALL Test Console</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      body {
        margin: 0;
      }
      main {
        margin: 0 auto;
        max-width: 1180px;
        padding: 28px;
      }
      header,
      section {
        border: 1px solid #dbe3ef;
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
      }
      header {
        padding: 24px;
      }
      h1,
      h2 {
        margin: 0;
      }
      p {
        color: #475569;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      button {
        min-height: 44px;
        cursor: pointer;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #f8fafc;
        color: #0f172a;
        font-weight: 650;
      }
      button:hover {
        background: #eef4ff;
        border-color: #93c5fd;
      }
      button.primary {
        background: #1d4ed8;
        border-color: #1d4ed8;
        color: #ffffff;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      section {
        margin-top: 16px;
        padding: 18px;
      }
      label {
        display: block;
        font-size: 0.84rem;
        font-weight: 700;
        color: #334155;
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        height: 42px;
        margin-top: 6px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 0 12px;
        color: #0f172a;
      }
      .inline {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 180px;
        gap: 12px;
      }
      pre {
        min-height: 360px;
        max-height: 58vh;
        overflow: auto;
        border-radius: 10px;
        background: #020617;
        color: #d1fae5;
        padding: 16px;
        white-space: pre-wrap;
      }
      .status {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-top: 14px;
      }
      .pill {
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 5px 10px;
        background: #f8fafc;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .ok {
        color: #047857;
      }
      .bad {
        color: #b91c1c;
      }
      @media (max-width: 720px) {
        main {
          padding: 14px;
        }
        .inline {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>ONCALL Test Console</h1>
        <p>Run the shared testing framework from VS Code or your terminal. The local buttons test the current checkout; the deployed URL button can test any previous, current, or future branch preview URL.</p>
        <div class="status">
          <span class="pill">Current branch: <span id="currentBranch">loading</span></span>
          <span class="pill">Run status: <span id="runStatus">idle</span></span>
        </div>
      </header>

      <section>
        <h2>Local Checkout</h2>
        <div class="grid">
          <button class="primary" data-action="verify">Full verification</button>
          <button data-action="unit">Unit/component tests</button>
          <button data-action="coverage">Coverage report</button>
          <button data-action="e2e-local">Local browser smoke</button>
          <button data-action="install">Install Playwright Chromium</button>
        </div>
      </section>

      <section>
        <h2>Branch Preview URL</h2>
        <p>Paste a Vercel preview or production page URL, including <strong>/tanovo-time</strong>.</p>
        <div class="inline">
          <label>
            Main page URL
            <input id="targetUrl" placeholder="https://your-branch.vercel.app/tanovo-time" />
          </label>
          <label>
            Branch label
            <select id="branchList"></select>
          </label>
        </div>
        <div class="grid">
          <button class="primary" data-action="e2e-url">Test deployed URL</button>
        </div>
      </section>

      <section>
        <h2>Output</h2>
        <pre id="output">Ready.</pre>
      </section>
    </main>

    <script>
      const output = document.querySelector("#output");
      const statusEl = document.querySelector("#runStatus");
      const currentBranchEl = document.querySelector("#currentBranch");
      const branchList = document.querySelector("#branchList");
      const targetUrl = document.querySelector("#targetUrl");
      const buttons = Array.from(document.querySelectorAll("button[data-action]"));

      function append(text) {
        output.textContent += text;
        output.scrollTop = output.scrollHeight;
      }

      function setButtons(disabled) {
        for (const button of buttons) button.disabled = disabled;
      }

      async function loadState() {
        const response = await fetch("/api/state");
        const state = await response.json();
        currentBranchEl.textContent = state.currentBranch;
        targetUrl.value = state.defaultTargetUrl || "";
        branchList.innerHTML = "";
        for (const branch of state.branches) {
          const option = document.createElement("option");
          option.value = branch;
          option.textContent = branch;
          option.selected = branch === state.currentBranch;
          branchList.append(option);
        }
      }

      async function run(action) {
        output.textContent = "";
        statusEl.textContent = "starting";
        statusEl.className = "";
        setButtons(true);

        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, targetUrl: targetUrl.value, branch: branchList.value }),
        });
        const data = await response.json();

        if (!response.ok) {
          append(data.error || "Unable to start run.");
          statusEl.textContent = "failed";
          statusEl.className = "bad";
          setButtons(false);
          return;
        }

        statusEl.textContent = "running";
        const events = new EventSource("/api/events?runId=" + encodeURIComponent(data.runId));
        events.addEventListener("log", (event) => {
          const entry = JSON.parse(event.data);
          append(entry.text);
        });
        events.addEventListener("done", (event) => {
          const result = JSON.parse(event.data);
          statusEl.textContent = result.status;
          statusEl.className = result.status === "passed" ? "ok" : "bad";
          setButtons(false);
          events.close();
        });
        events.onerror = () => {
          append("\\nConnection to test run closed.\\n");
          setButtons(false);
          events.close();
        };
      }

      for (const button of buttons) {
        button.addEventListener("click", () => run(button.dataset.action));
      }

      loadState().catch((error) => {
        currentBranchEl.textContent = "unknown";
        append("\\nFailed to load test console state: " + error.message + "\\n");
      });
    </script>
  </body>
</html>`
}

/**
 * Handles incoming dashboard and API requests.
 *
 * @param {import("node:http").IncomingMessage} request - HTTP request.
 * @param {import("node:http").ServerResponse} response - HTTP response.
 * @returns {Promise<void>}
 */
async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`)

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    response.end(renderDashboard())
    return
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, {
      ...getBranchState(),
      defaultTargetUrl: process.env.MAIN_PAGE_URL ?? process.env.TEST_TARGET_URL ?? "",
    })
    return
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    try {
      const body = await readJsonBody(request)
      const command = commandForAction(body)
      if (!command) {
        sendJson(response, { error: "Unknown action or invalid deployed URL." }, 400)
        return
      }

      const runId = startRun(
        command.label,
        command.executable,
        command.args,
        command.env,
      )
      sendJson(response, { runId })
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : "Bad request." }, 400)
    }
    return
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const runId = url.searchParams.get("runId")
    const run = runId ? runs.get(runId) : null
    if (!run) {
      response.writeHead(404)
      response.end("Unknown run.")
      return
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    })

    run.clients.add(response)
    for (const entry of run.logs) {
      response.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
    }
    if (run.status !== "running") {
      response.write(
        `event: done\ndata: ${JSON.stringify({
          status: run.status,
          exitCode: run.exitCode,
          finishedAt: run.finishedAt,
        })}\n\n`,
      )
      response.end()
      return
    }

    request.on("close", () => {
      run.clients.delete(response)
    })
    return
  }

  response.writeHead(404)
  response.end("Not found.")
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, { error: error instanceof Error ? error.message : "Server error." }, 500)
  })
})

server.listen(port, host, () => {
  console.log(`ONCALL Test Console: http://${host}:${port}`)
})
