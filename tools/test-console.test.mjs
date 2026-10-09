// @vitest-environment node
/**
 * Tests structured streaming, duplicate identities, local-only commands, and SSE.
 * HTTP fixtures use ephemeral loopback ports and injected runners, never real builds.
 * These tests verify console infrastructure independently of application accounts.
 */
import { afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import {
  caseRow,
  categorize,
  eventParser,
  EVENT_PREFIX,
} from "./test-events.mjs";
import { actionSteps, createTestConsole, normalizeTarget } from "./test-ui.mjs";
let server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

/**
 * Starts a disposable server with synthetic inventory and an injected executor.
 * @param {Function} executor - Command substitute reporting safe fixture outcomes.
 * @returns {Promise<string>} Ephemeral local URL.
 */
async function fixture(
  executor,
  row = caseRow({ file: "lib/sample.test.ts", name: "sample case" }),
) {
  server = createTestConsole({
    watchFiles: false,
    discoverTests: async () => ({ rows: [row], errors: [] }),
    executeStep:
      executor ??
      (async (_args, _env, event) => {
        event({ type: "case", row: { ...row, state: "running" } });
        event({ type: "case", row: { ...row, state: "passed", duration: 7 } });
        return 0;
      }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

it("categorizes test layers independently of feature areas", () => {
  expect(categorize("app/api/users/route.test.ts")).toEqual({
    category: "API",
    area: "Access & roles",
  });
  expect(categorize("components/messages-panel.test.tsx")).toEqual({
    category: "UI",
    area: "Messaging",
  });
  expect(categorize("e2e/sign-in.spec.ts", "browser").category).toBe("Browser");
});
it("preserves duplicate parameterized cases as distinct stable rows", () => {
  const first = caseRow({
    file: "lib/sample.test.ts",
    name: "same name",
    occurrence: 0,
  });
  const second = caseRow({
    file: "lib/sample.test.ts",
    name: "same name",
    occurrence: 1,
  });
  expect(first.id).not.toBe(second.id);
  expect(first.id).toBe(
    caseRow({
      file: "lib/sample.test.ts",
      name: "same name",
      occurrence: 0,
      state: "passed",
    }).id,
  );
});
it("handles split JSON protocol chunks without mistaking terminal logs for outcomes", () => {
  const events = vi.fn(),
    logs = vi.fn(),
    parser = eventParser(events, logs);
  parser.write("ordinary log\n" + EVENT_PREFIX + '{"type":"ca');
  parser.write('se","row":{"id":"one"}}\ntrailing');
  parser.flush();
  expect(events).toHaveBeenCalledWith({ type: "case", row: { id: "one" } });
  expect(logs).toHaveBeenCalledWith("ordinary log\n");
  expect(logs).toHaveBeenCalledWith("trailing\n");
});
it("keeps malformed protocol visible as a log rather than inventing a pass", () => {
  const events = vi.fn(),
    logs = vi.fn(),
    parser = eventParser(events, logs);
  parser.write(EVENT_PREFIX + "not-json\n");
  expect(events).not.toHaveBeenCalled();
  expect(logs).toHaveBeenCalledOnce();
});
it("rejects executable URLs, credentials, and remote URLs for local runs", () => {
  expect(normalizeTarget("javascript:alert(1)")).toBeNull();
  expect(normalizeTarget("https://user:secret@example.com/timelog")).toBeNull();
  expect(
    actionSteps({
      action: "e2e-local",
      localUrl: "https://example.com/timelog",
    }),
  ).toBeNull();
  expect(
    actionSteps({
      action: "e2e-url",
      targetUrl: "https://example.com/timelog",
    })[0].env.TEST_TARGET_URL,
  ).toBe("https://example.com/timelog");
});
it("returns fresh inventory and replays live case results to SSE clients", async () => {
  const base = await fixture();
  expect((await (await fetch(base + "/api/tests")).json()).rows).toHaveLength(
    1,
  );
  const started = await (
    await fetch(base + "/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unit" }),
    })
  ).json();
  const text = await (
    await fetch(base + "/api/events?runId=" + started.runId)
  ).text();
  expect(text).toContain("event: snapshot");
  expect(text).toContain("event: done");
  const results = await (
    await fetch(base + "/api/results?runId=" + started.runId)
  ).json();
  expect(results.status).toBe("passed");
  expect(results.rows[0].duration).toBe(7);
  expect(results).not.toHaveProperty("env");
});
it("does not claim success when an executor omits discovered case outcomes", async () => {
  const base = await fixture(async () => 0);
  const started = await (
    await fetch(base + "/api/run", {
      method: "POST",
      body: JSON.stringify({ action: "unit" }),
    })
  ).json();
  await (await fetch(base + "/api/events?runId=" + started.runId)).text();
  const result = await (
    await fetch(base + "/api/results?runId=" + started.runId)
  ).json();
  expect(result.status).toBe("failed");
  expect(result.rows.find((row) => row.name === "sample case").state).toBe(
    "not_run",
  );
});
it("rejects concurrent commands and cross-origin command requests", async () => {
  let release;
  const base = await fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const request = () =>
    fetch(base + "/api/run", {
      method: "POST",
      body: JSON.stringify({ action: "unit" }),
    });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(409);
  expect(
    (
      await fetch(base + "/api/run", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
        body: '{"action":"unit"}',
      })
    ).status,
  ).toBe(403);
  release(1);
});
it("blocks DNS-rebinding hostnames and unknown actions", async () => {
  const base = await fixture();
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(
      base + "/api/state",
      { headers: { Host: "untrusted.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  expect(status).toBe(403);
  expect(
    (
      await fetch(base + "/api/run", {
        method: "POST",
        body: '{"action":"arbitrary-command"}',
      })
    ).status,
  ).toBe(400);
});

it("serves explanations only for discovered IDs, not arbitrary source paths", async () => {
  const row = caseRow({
    file: "lib/permissions.test.ts",
    name: "does not grant rights to denied accounts",
  });
  const base = await fixture(undefined, row);
  const response = await fetch(base + "/api/test-details?id=" + row.id);
  const details = await response.json();
  expect(response.status).toBe(200);
  expect(details.targets).toContain("resolvePermissions");
  expect(details.code.some((block) => block.file === "tests/setup.ts")).toBe(
    true,
  );
  expect(
    (await fetch(base + "/api/test-details?id=../../.env.local")).status,
  ).toBe(404);
  expect(
    (await fetch(base + "/api/test-details?id=" + row.id + "&runId=unknown"))
      .status,
  ).toBe(404);
});
