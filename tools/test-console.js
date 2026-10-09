/**
 * Drives live test rows, category/area/status filters, and full-screen diagnostics.
 * SSE snapshots survive reconnects; user-supplied names/errors use textContent.
 * Runs execute the checked-out source; deployment branches are labels only.
 */
const $ = (id) => document.getElementById(id);
const rows = new Map();
let stream = null,
  currentRun = null,
  selectedCase = null,
  sourceBranch = "",
  logs = "",
  busy = false,
  frame = null;
const labels = {
  not_run: "Not run",
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  flaky: "Flaky",
  pending: "Queued",
};

/**
 * Creates an element containing text, never interpreted HTML from test results.
 * @param {string} tag - Element tag.
 * @param {string} text - User-visible content.
 * @param {string} className - Optional known CSS class.
 * @returns {HTMLElement} Safe element.
 */
function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** @param {string} id - Filter select ID. @param {string[]} values - Discovered labels. @returns {void} Preserves the current selection when possible. */
function options(id, values) {
  const select = $(id),
    previous = select.value;
  while (select.options.length > 1) select.remove(1);
  for (const value of [...new Set(values)].sort()) {
    const option = element("option", value);
    option.value = value;
    select.append(option);
  }
  select.value = values.includes(previous) ? previous : "";
}

/** @returns {void} Schedules one render for batched incoming reporter events. */
function schedule() {
  if (frame === null)
    frame = requestAnimationFrame(() => {
      frame = null;
      render();
    });
}

/** @returns {void} Renders all filtered tests and totals from current structured state. */
function render() {
  const all = [...rows.values()];
  options(
    "category",
    all.map((row) => row.category),
  );
  options(
    "area",
    all.map((row) => row.area),
  );
  const cases = all.filter((row) => row.kind !== "check");
  $("totalCount").textContent = cases.length;
  for (const state of ["passed", "failed", "running", "skipped"])
    $(state + "Count").textContent = cases.filter(
      (row) => row.state === state,
    ).length;
  $("checksCount").textContent = all.filter(
    (row) => row.kind === "check",
  ).length;
  const query = $("search").value.toLowerCase();
  const filtered = all.filter(
    (row) =>
      (!$("category").value || row.category === $("category").value) &&
      (!$("area").value || row.area === $("area").value) &&
      (!$("status").value || row.state === $("status").value) &&
      (!query ||
        [row.name, row.file].some((value) =>
          value.toLowerCase().includes(query),
        )),
  );
  filtered.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.area.localeCompare(b.area) ||
      a.file.localeCompare(b.file) ||
      a.name.localeCompare(b.name) ||
      a.occurrence - b.occurrence,
  );
  const body = $("testRows");
  body.replaceChildren();
  for (const row of filtered) {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.append(element("td", row.category), element("td", row.area));
    const name = element("td");
    const nameText = element("span", row.name, "case-name");
    nameText.title = row.name;
    name.append(nameText);
    tr.append(name);
    const file = element("td", row.file, "file file-column");
    file.title = row.file;
    tr.append(file);
    const status = element("td", labels[row.state] ?? row.state, "row-status");
    status.dataset.state = row.state;
    tr.append(status);
    tr.append(
      element(
        "td",
        typeof row.duration === "number"
          ? Math.round(row.duration) + " ms"
          : "--",
        "numeric",
      ),
    );
    const actions = element("td", "", "action-column");
    const button = element("button", "", "details-button");
    button.title = "View test details";
    button.setAttribute("aria-label", "View details: " + row.name);
    button.append($("detailIcon").content.cloneNode(true));
    button.addEventListener("click", () => openCase(row.id));
    actions.append(button);
    tr.append(actions);
    body.append(tr);
  }
  if (!filtered.length) {
    const tr = element("tr"),
      td = element("td", "No tests match these filters.");
    td.colSpan = 7;
    tr.append(td);
    body.append(tr);
  }
  $("visibleCount").textContent = `${filtered.length} of ${all.length} rows`;
  if (selectedCase && $("detailWindow").open && rows.has(selectedCase))
    detail(rows.get(selectedCase));
}

/** @param {string} mode - Detail, logs, or browser targets. @param {string} title - Dialog title. @returns {void} Opens one full-screen native modal. */
function windowView(mode, title) {
  $("detailTitle").textContent = title;
  for (const name of ["test", "log", "target"])
    $(name + "Detail").hidden = name !== mode;
  if (!$("detailWindow").open) $("detailWindow").showModal();
}
/** @param {object} row - Selected case. @returns {void} Updates metadata/error details safely. */
function detail(row) {
  const fields = $("detailFields");
  fields.replaceChildren();
  for (const [label, value] of Object.entries({
    Test: row.name,
    Category: row.category,
    Area: row.area,
    File: row.file,
    Status: labels[row.state] ?? row.state,
    Duration:
      typeof row.duration === "number"
        ? Math.round(row.duration) + " ms"
        : "Not completed",
    Project: row.project || "Default",
    Started: row.startedAt ? new Date(row.startedAt).toLocaleString() : "--",
    Finished: row.finishedAt ? new Date(row.finishedAt).toLocaleString() : "--",
  })) {
    const item = document.createElement("div");
    item.append(element("dt", label), element("dd", value));
    fields.append(item);
  }
  $("detailErrors").textContent =
    (row.errors ?? [])
      .map((error) => error.stack || error.message || String(error))
      .join("\n\n") || "No failure details.";
}
/** @param {string} id - Stable case ID. @returns {void} Opens its full diagnostics window. */
function openCase(id) {
  selectedCase = id;
  detail(rows.get(id));
  windowView("test", "Test details");
}

/** @param {boolean} value - Whether a command is active. @returns {void} Prevents concurrent UI launches. */
function setBusy(value) {
  busy = value;
  $("history").disabled = value;
  for (const button of document.querySelectorAll(
    "[data-action],#refreshCatalog",
  ))
    button.disabled = value;
}

/** @param {boolean} refresh - Whether to recollect source files. @returns {Promise<void>} Updates all inventory cases without running them. */
async function loadCatalog(refresh = false) {
  $("runStatus").textContent = "Discovering tests...";
  const response = await fetch("/api/tests" + (refresh ? "?refresh=1" : ""));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  rows.clear();
  for (const row of data.rows) rows.set(row.id, row);
  $("catalogErrors").textContent = (data.errors ?? []).join("\n");
  $("catalogErrors").hidden = !data.errors?.length;
  $("runStatus").textContent = data.errors?.length
    ? "Discovery needs attention"
    : "Ready";
  schedule();
}

/** @returns {Promise<void>} Refreshes branch labels and saved runs without changing Git state. */
async function loadState() {
  const response = await fetch("/api/state");
  const data = await response.json();
  sourceBranch = data.currentBranch;
  $("currentBranch").textContent = sourceBranch;
  const previous = $("branchList").value;
  $("branchList").replaceChildren();
  for (const branch of data.branches) {
    const option = element("option", branch);
    option.value = branch;
    $("branchList").append(option);
  }
  $("branchList").value = previous || sourceBranch;
  const history = $("history");
  history.replaceChildren(element("option", "Current inventory"));
  history.options[0].value = "";
  for (const run of [...data.runs].reverse()) {
    const option = element(
      "option",
      `${run.label} · ${run.status} · ${new Date(run.startedAt).toLocaleTimeString()}`,
    );
    option.value = run.id;
    history.append(option);
  }
  history.value = currentRun ?? "";
  if (!$("targetUrl").value) $("targetUrl").value = data.defaultTargetUrl || "";
  const active = data.runs.find((run) => run.status === "running");
  if (active && !currentRun) connect(active.id);
}

/** @param {object} data - Current run snapshot. @returns {void} Restores outcomes after reconnect or history navigation. */
function snapshot(data) {
  rows.clear();
  for (const row of data.rows) rows.set(row.id, row);
  logs = data.logs;
  $("output").textContent = logs;
  $("runStatus").textContent = data.status;
  $("exportResults").disabled = false;
  schedule();
}

/** @param {string} id - Existing run ID. @returns {void} Attaches live SSE updates with reconnect support. */
function connect(id) {
  stream?.close();
  currentRun = id;
  stream = new EventSource("/api/events?runId=" + encodeURIComponent(id));
  stream.addEventListener("snapshot", (event) => {
    const data = JSON.parse(event.data);
    snapshot(data);
    setBusy(data.status === "running");
  });
  stream.addEventListener("case", (event) => {
    const row = JSON.parse(event.data);
    rows.set(row.id, { ...rows.get(row.id), ...row });
    schedule();
  });
  stream.addEventListener(
    "stage",
    (event) => ($("currentStage").textContent = JSON.parse(event.data).label),
  );
  stream.addEventListener("log", (event) => {
    logs = (logs + JSON.parse(event.data).text).slice(-1000000);
    $("output").textContent = logs;
    $("output").scrollTop = $("output").scrollHeight;
  });
  stream.addEventListener("done", (event) => {
    snapshot(JSON.parse(event.data));
    setBusy(false);
    $("currentStage").textContent = "";
    stream.close();
    void loadState();
  });
  stream.onerror = () => {
    if (busy) $("runStatus").textContent = "Reconnecting to active run...";
  };
}

/** @param {string} action - Fixed command action. @returns {Promise<void>} Starts a run and its live result stream. */
async function run(action) {
  if (busy) return;
  setBusy(true);
  $("runStatus").textContent = "Starting...";
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        branch: action === "e2e-url" ? $("branchList").value : sourceBranch,
        targetUrl: $("targetUrl").value,
        localUrl: $("localUrl").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $("detailWindow").close();
    connect(data.runId);
    void loadState();
  } catch (error) {
    $("runStatus").textContent = error.message;
    setBusy(false);
  }
}

for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", () => void run(button.dataset.action));
for (const id of ["search", "category", "area", "status"])
  $(id).addEventListener("input", schedule);
$("closeWindow").addEventListener("click", () => {
  $("detailWindow").close();
  selectedCase = null;
});
$("openLogs").addEventListener("click", () => {
  selectedCase = null;
  windowView("log", "Run output");
});
$("openTargets").addEventListener("click", () => {
  selectedCase = null;
  windowView("target", "Browser targets");
});
$("refreshCatalog").addEventListener("click", async () => {
  try {
    setBusy(true);
    currentRun = null;
    stream?.close();
    await loadState();
    if (!currentRun) await loadCatalog(true);
  } catch (error) {
    $("runStatus").textContent = error.message;
  } finally {
    if (!currentRun) setBusy(false);
  }
});
$("history").addEventListener("change", async () => {
  const id = $("history").value;
  if (id) connect(id);
  else {
    stream?.close();
    currentRun = null;
    setBusy(false);
    await loadCatalog();
  }
});
$("exportResults").addEventListener("click", async () => {
  if (!currentRun) return;
  const response = await fetch(
    "/api/results?runId=" + encodeURIComponent(currentRun),
  );
  const data = await response.json();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "test-results-" + currentRun + ".json";
  link.click();
  URL.revokeObjectURL(url);
});
setBusy(true);
loadState()
  .then(() => {
    if (!currentRun) return loadCatalog();
  })
  .catch((error) => {
    $("runStatus").textContent = error.message;
  })
  .finally(() => {
    if (!currentRun) setBusy(false);
  });
