// @vitest-environment node
/**
 * Tests source-backed test documentation without importing fixture test modules.
 * Covers syntax matching, scoped setup, lazy targets, and source-path restrictions.
 * Prevents misleading explanations and arbitrary file disclosure in the local console.
 */
import { expect, it } from "vitest";
import { analyzeTest, explainTest } from "./test-explanations.mjs";
import { caseRow } from "./test-events.mjs";

it("extracts a case, targets, mocks and setup without executing source", () => {
  const source = `/** Checks permission isolation. */
import { it, beforeEach, expect, vi } from 'vitest';
import { authorize as check } from './access';
vi.mock('./db', () => ({}));
const fixture = {role:'employee'};
beforeEach(() => vi.clearAllMocks());
throw new Error('must never execute');
it('denies access', () => { expect(check(fixture)).toBe(false); });`;
  const details = analyzeTest(
    caseRow({ file: "lib/access.test.ts", name: "denies access" }),
    source,
  );
  expect(details.purpose).toContain("Checks permission isolation");
  expect(details.targets).toContain("authorize (./access)");
  expect(details.setup).toContain("./db");
  expect(details.setup).toContain("beforeEach");
  expect(details.code[0].code).toContain("const fixture");
  expect(details.code[0].code).not.toContain("it('denies access'");
  expect(details.code[1].code).toContain("expect(check(fixture)).toBe(false)");
});

it("keeps parameterized definitions and reports the selected variant", () => {
  const details = analyzeTest(
    caseRow({
      file: "lib/sample.test.ts",
      name: "rejects invalid data",
      occurrence: 1,
    }),
    `it.each([null, false])('rejects invalid data', value => { expect(value).toBeFalsy(); });`,
  );
  expect(details.cases).toContain("variant 2");
  expect(details.code[1].code).toContain("[null, false]");
});

it("includes enclosing hooks but excludes sibling suite setup", () => {
  const details = analyzeTest(
    caseRow({ file: "lib/sample.test.ts", name: "one > works" }),
    `describe('one', () => { beforeEach(() => resetOne()); it('works', () => { expect(true).toBe(true); }); }); describe('two', () => { beforeEach(() => resetTwo()); it('works', () => {}); });`,
  );
  expect(details.code[0].code).toContain("resetOne");
  expect(details.code[0].code).not.toContain("resetTwo");
  const other = analyzeTest(
    caseRow({ file: "lib/sample.test.ts", name: "two > works" }),
    `describe('one', () => { it('works', () => { expect(false).toBe(false); }); }); describe('two', () => { it('works', () => { expect(true).toBe(true); }); });`,
  );
  expect(other.code[1].code).toContain("expect(true)");
});

it("identifies lazily imported target functions", () => {
  const details = analyzeTest(
    caseRow({ file: "lib/sample.test.ts", name: "saves" }),
    `let storage; beforeAll(async () => { storage = await import('./db'); }); it('saves', async () => { await storage.save(); });`,
  );
  expect(details.targets).toContain("save (./db)");
});

it("does not fabricate code for an unmatched dynamic runner title", () => {
  const details = analyzeTest(
    caseRow({ file: "lib/sample.test.ts", name: "dynamic title" }),
    `it(makeTitle(), () => { expect(true).toBe(true); });`,
  );
  expect(details.cases).toContain("could not be matched");
  expect(details.code).toHaveLength(1);
});

it("reads actual test setup and refuses environment or outside files", () => {
  const details = explainTest(
    caseRow({
      file: "lib/permissions.test.ts",
      name: "does not grant rights to denied accounts",
    }),
  );
  expect(details.code.map((block) => block.file)).toContain("tests/setup.ts");
  expect(details.targets).toContain("resolvePermissions");
  expect(() =>
    explainTest(caseRow({ file: ".env.local", name: "secret" })),
  ).toThrow();
  expect(() =>
    explainTest(caseRow({ file: "../outside.test.ts", name: "outside" })),
  ).toThrow();
});

it("documents toolchain checks without pretending they assert a function", () => {
  const details = explainTest(
    caseRow({ file: "", kind: "check", name: "TypeScript" }),
  );
  expect(details.code[0].code).toBe("pnpm typecheck");
  expect(details.targets).toContain("toolchain");
});
