/**
 * Builds concise, source-backed documentation for console test details.
 * TypeScript's syntax tree identifies cases, imports, fixtures, and setup hooks.
 * Reading source never imports tests or executes their setup; paths stay in the checkout.
 */
import ts from "typescript";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const hooks = new Set(["beforeAll", "beforeEach", "afterEach", "afterAll"]);
const reasons = {
  "Access & roles":
    "Prevents unauthorized role or permission changes and protects administrators from accidental lockout.",
  Messaging:
    "Protects message privacy and lifecycle behavior so edits, receipts, and notifications follow the intended rules.",
  Security:
    "Protects security monitoring and access boundaries from regressions that could hide risks or disclose restricted information.",
  Authentication:
    "Keeps the required Microsoft sign-in entry point and authentication behavior usable.",
  Timesheets:
    "Protects time-entry ownership and review workflows from incorrect state changes.",
  "Test framework":
    "Keeps test discovery and reporting trustworthy, and prevents unsafe commands from the local console.",
  General:
    "Detects regressions in the behavior asserted by this case before changes are released.",
};

/**
 * Visits a syntax subtree without evaluating any expressions.
 * @param {ts.Node} node - Syntax root.
 * @param {Function} visit - Visitor called for every node.
 * @returns {void} Walks the subtree.
 */
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * Determines the originating runner name through modifiers such as it.each.
 * @param {ts.Expression} expression - Call receiver.
 * @returns {string} Base identifier, or an empty string.
 */
function receiver(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression))
    return receiver(expression.expression);
  if (
    ts.isCallExpression(expression) ||
    ts.isTaggedTemplateExpression(expression)
  )
    return receiver(expression.expression ?? expression.tag);
  return "";
}

/**
 * Parses an actual test file into a selected case, setup, and referenced targets.
 * Unsupported dynamically generated titles are reported explicitly, not invented.
 * @param {object} row - Discovered runner case.
 * @param {string} source - Test source text.
 * @returns {object} Source-backed paragraphs and exact code blocks.
 */
export function analyzeTest(row, source) {
  const file = ts.createSourceFile(
    row.file,
    source,
    ts.ScriptTarget.Latest,
    true,
    row.file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const cases = [],
    imports = new Map(),
    setup = new Set();
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      const module = statement.moduleSpecifier.text,
        clause = statement.importClause;
      if (clause.name)
        imports.set(clause.name.text, { module, symbol: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
          if (!item.isTypeOnly)
            imports.set(item.name.text, {
              module,
              symbol: item.propertyName?.text ?? item.name.text,
            });
      if (bindings && ts.isNamespaceImport(bindings))
        imports.set(bindings.name.text, { module, symbol: "*" });
    }
    if (
      ts.isImportDeclaration(statement) ||
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    )
      setup.add(statement);
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression)
    ) {
      const call = statement.expression,
        base = receiver(call.expression);
      if (
        hooks.has(base) ||
        (base === "vi" &&
          /\.mock\b|\.stub|\.hoisted/.test(call.expression.getText(file)))
      )
        setup.add(statement);
    }
  }
  walk(file, (node) => {
    // Namespace assignments inside beforeAll also identify lazy production imports.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const value = ts.isAwaitExpression(node.right)
        ? node.right.expression
        : node.right;
      if (
        ts.isCallExpression(value) &&
        value.expression.kind === ts.SyntaxKind.ImportKeyword &&
        value.arguments[0] &&
        ts.isStringLiteral(value.arguments[0])
      )
        imports.set(node.left.text, {
          module: value.arguments[0].text,
          symbol: "*",
        });
    }
    if (
      !ts.isCallExpression(node) ||
      !["it", "test"].includes(receiver(node.expression))
    )
      return;
    const title = node.arguments[0];
    if (
      !title ||
      !(ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
    )
      return;
    const callback = node.arguments.find(
      (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
    );
    if (callback && !/\.describe\b/.test(node.expression.getText(file))) {
      const scopes = [];
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isCallExpression(parent)) continue;
        if (
          receiver(parent.expression) !== "describe" &&
          !/\.describe\b/.test(parent.expression.getText(file))
        )
          continue;
        if (parent.arguments[0] && ts.isStringLiteral(parent.arguments[0]))
          scopes.unshift(parent.arguments[0].text);
      }
      cases.push({
        node,
        title: title.text,
        fullTitle: [...scopes, title.text].join(" "),
        callback,
      });
    }
  });
  const runnerTitle = row.name.replace(/\s+>\s+/g, " ");
  const scopedMatches = cases.filter(
    (item) =>
      runnerTitle === item.fullTitle ||
      runnerTitle.endsWith(" " + item.fullTitle),
  );
  const matches = scopedMatches.length
    ? scopedMatches
    : cases.filter(
        (item) =>
          row.name === item.title ||
          row.name.endsWith(" > " + item.title) ||
          row.name.endsWith(" " + item.title),
      );
  const selected = matches[row.occurrence ?? 0] ?? matches[0];
  const header = source
    .match(/\/\*\*([\s\S]*?)\*\//)?.[1]
    ?.split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("@"))
    .join(" ");
  const targets = new Set(),
    assertions = [],
    mockedModules = new Set(),
    hookNames = new Set(),
    fixtureNames = new Set();
  if (selected) {
    walk(selected.callback, (node) => {
      if (ts.isIdentifier(node) && imports.has(node.text)) {
        const { module, symbol } = imports.get(node.text);
        if (module.startsWith(".") || module.startsWith("@/")) {
          if (
            symbol === "*" &&
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node
          )
            targets.add(node.parent.name.text + " (" + module + ")");
          else if (symbol !== "*")
            targets.add(
              (symbol === "default"
                ? node.text + " [default export]"
                : symbol) +
                " (" +
                module +
                ")",
            );
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "expect"
      ) {
        let chain = node;
        while (
          (ts.isPropertyAccessExpression(chain.parent) ||
            ts.isCallExpression(chain.parent)) &&
          chain.parent.expression === chain
        )
          chain = chain.parent;
        assertions.push(chain.getText(file));
      }
    });
    // Include hooks and fixture declarations in each enclosing describe scope.
    for (let parent = selected.node.parent; parent; parent = parent.parent) {
      if (!ts.isBlock(parent)) continue;
      for (const statement of parent.statements) {
        if (
          ts.isVariableStatement(statement) ||
          ts.isFunctionDeclaration(statement)
        )
          setup.add(statement);
        if (
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          hooks.has(receiver(statement.expression.expression))
        )
          setup.add(statement);
      }
    }
  }
  for (const statement of setup) {
    if (ts.isFunctionDeclaration(statement) && statement.name)
      fixtureNames.add(statement.name.text);
    walk(statement, (node) => {
      if (!ts.isCallExpression(node)) return;
      const text = node.expression.getText(file);
      if (hooks.has(text)) hookNames.add(text);
      if (
        text === "vi.mock" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        mockedModules.add(node.arguments[0].text);
    });
  }
  const setupCode = [...setup]
    .sort((a, b) => a.pos - b.pos)
    .map((node) => node.getText(file))
    .join("\n\n");
  const parameterized =
    selected && /\.each\b/.test(selected.node.expression.getText(file));
  return {
    purpose:
      "Verifies: " +
      row.name +
      ". " +
      (header ??
        "The assertions below define the behavior checked by this test."),
    necessity: reasons[row.area] ?? reasons.General,
    targets: targets.size
      ? "Production imports exercised or referenced by this case: " +
        [...targets].join("; ") +
        "."
      : "No direct production import was identified in this case. It may test an HTTP endpoint, a tool, or a locally constructed fixture; the case code below shows the boundary.",
    cases: selected
      ? "This case contains " +
        assertions.length +
        " assertion(s)." +
        (parameterized
          ? " It is parameterized; the each() data in the case code supplies its variants. This row is variant " +
            ((row.occurrence ?? 0) + 1) +
            "."
          : "") +
        (assertions.length
          ? " Expectations include: " +
            assertions
              .slice(0, 2)
              .map((text) => text.replace(/\s+/g, " ").slice(0, 220))
              .join("; ") +
            "."
          : "") +
        " Full inputs and expectations appear in the case code."
      : "The runner title could not be matched to a static case definition. Dynamic title generation requires an explicit description; no case code has been guessed.",
    setup:
      row.kind === "browser"
        ? "Playwright creates the browser page fixture. TEST_TARGET_URL selects the page; otherwise the test uses its configured local base URL. The source and runner configuration below show the actual setup."
        : "Vitest uses " +
          (source.includes("@vitest-environment node")
            ? "Node"
            : "the configured jsdom environment") +
          " and loads tests/setup.ts." +
          (mockedModules.size
            ? " Mocked dependencies: " + [...mockedModules].join(", ") + "."
            : " No vi.mock declarations were identified.") +
          (fixtureNames.size
            ? " Local fixture helpers: " + [...fixtureNames].join(", ") + "."
            : "") +
          (hookNames.size
            ? " Lifecycle hooks: " +
              [...hookNames].join(", ") +
              "; their exact reset and cleanup operations are shown below."
            : ""),
    code: [
      {
        title: "File setup and fixtures",
        file: row.file,
        language: row.file.endsWith("mjs") ? "javascript" : "typescript",
        code: setupCode || "// No file-level setup.",
      },
      ...(selected
        ? [
            {
              title: "Selected test case",
              file:
                row.file +
                ":" +
                (file.getLineAndCharacterOfPosition(
                  selected.node.getStart(file),
                ).line +
                  1),
              language: row.file.endsWith("mjs") ? "javascript" : "typescript",
              code: selected.node.getText(file),
            },
          ]
        : []),
    ],
  };
}

/**
 * Reads only real test sources and approved shared runner setup within the checkout.
 * @param {object} row - Server-selected inventory row; never an arbitrary browser path.
 * @returns {object} Concise documentation with exact setup and case code.
 */
export function explainTest(row) {
  if (row.kind === "check") {
    const commands = {
      TypeScript: "pnpm typecheck",
      "Production build": "pnpm build",
      "Install Chromium": "pnpm test:install",
    };
    const command = commands[row.name];
    return {
      purpose: command
        ? "Runs " + command + " for the current checkout."
        : "Reports a runner-level failure rather than an individual test case.",
      necessity:
        "Checks catch compiler, packaging, or runner failures that individual assertions cannot detect.",
      targets:
        "Targets the configured toolchain, not a single application function.",
      cases:
        "Success requires a zero exit status. Test assertions are reported separately.",
      setup:
        "The console invokes the installed tool directly with the current checkout as its working directory.",
      code: command
        ? [
            {
              title: "Command",
              file: "package.json",
              language: "shell",
              code: command,
            },
          ]
        : [],
    };
  }
  const path = realpathSync(resolve(root, row.file)),
    safeRoot = realpathSync(root),
    rel = relative(safeRoot, path);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
    !/\.(test|spec)\.(tsx?|m?[jt]s)$/.test(path)
  )
    throw new Error("Only checkout test files can be explained");
  const result = analyzeTest(row, readFileSync(path, "utf8"));
  const shared =
    row.kind === "browser"
      ? ["playwright.config.ts"]
      : ["vitest.config.mts", "tests/setup.ts"];
  for (const file of shared)
    result.code.push({
      title: "Shared setup",
      file,
      language: "typescript",
      code: readFileSync(resolve(root, file), "utf8"),
    });
  return result;
}
