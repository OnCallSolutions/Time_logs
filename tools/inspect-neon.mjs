import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { neon } from "@neondatabase/serverless"

const help = `Tanovo Time Neon database inspector (read-only)

Usage:
  pnpm db:inspect                         List application tables and row counts
  pnpm db:inspect -- --schema             List columns for every application table
  pnpm db:inspect -- --table time_entries  Print up to 100 rows from one table
  pnpm db:inspect -- --table time_entries --limit 500
  pnpm db:inspect -- --table time_entries --all
  pnpm db:inspect -- --all                 Print every row from every application table

Options:
  --table NAME   Read one table (optionally schema-qualified as schema.table)
  --schema       Show columns and PostgreSQL types for all application tables
  --limit N      Maximum rows per selected table (default: 100)
  --all          With --table, print all rows from that table; alone, dump all tables
  --help         Show this help

The connection comes from DATABASE_URL, .env.local, .env.development.local, or .env.
Results are displayed as aligned terminal tables; long cell values wrap to additional lines.
The URL is never printed. This script runs SELECT queries only. Output may contain
personal or confidential records; handle terminal logs and redirected files accordingly.
`

const useColor = process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY || process.env.FORCE_COLOR)
const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  header: "\u001b[1;97;44m",
  muted: "\u001b[90m",
  alternate: "\u001b[94m",
  green: "\u001b[32m",
  orange: "\u001b[33m",
  red: "\u001b[31m",
}

function paint(value, color) {
  return useColor ? `${color}${value}${ansi.reset}` : value
}

function displayValue(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function wrapCell(value, width) {
  const physicalLines = displayValue(value).split(/\r?\n/)
  const wrapped = []
  for (const physicalLine of physicalLines) {
    const words = physicalLine.split(/\s+/).filter(Boolean)
    let line = ""
    for (const word of words.length ? words : [""]) {
      if (word.length > width) {
        if (line) wrapped.push(line)
        line = ""
        for (let index = 0; index < word.length; index += width) {
          const part = word.slice(index, index + width)
          if (part.length === width) wrapped.push(part)
          else line = part
        }
      } else if (!line) line = word
      else if (line.length + word.length + 1 <= width) line += ` ${word}`
      else {
        wrapped.push(line)
        line = word
      }
    }
    if (line || !words.length) wrapped.push(line)
  }
  return wrapped.length ? wrapped : [""]
}

function terminalColumnWidths(columns, rows) {
  const terminalWidth = Math.max(60, process.stdout.columns || 120)
  const minimumWidth = columns.length > terminalWidth / 7 ? 2 : 4
  const available = Math.max(columns.length * minimumWidth, terminalWidth - 1 - columns.length * 3)
  const widths = columns.map(column => {
    const samples = rows.slice(0, 100).map(row => displayValue(row[column]).split(/\r?\n/).reduce((max, part) => Math.max(max, part.length), 0))
    return Math.max(minimumWidth, Math.min(32, Math.max(column.length, ...samples)))
  })

  let used = widths.reduce((sum, width) => sum + width, 0)
  while (used > available) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest] <= minimumWidth) break
    widths[widest] -= 1
    used -= 1
  }
  return widths
}

function renderTable(title, columns, rows) {
  console.log(`\n${paint(title, ansi.bold)} · ${rows.length} row${rows.length === 1 ? "" : "s"}`)
  if (!columns.length) {
    console.log(paint("  No columns", ansi.muted))
    return
  }
  if (!rows.length) {
    console.log(paint("  No rows", ansi.muted))
    return
  }

  const widths = terminalColumnWidths(columns, rows)
  const border = `+${widths.map(width => "-".repeat(width + 2)).join("+")}+`
  console.log(paint(border, ansi.cyan))
  const header = `| ${columns.map((column, index) => column.slice(0, widths[index]).padEnd(widths[index])).join(" | ")} |`
  console.log(paint(header, ansi.header))
  console.log(paint(border, ansi.cyan))

  rows.forEach((row, rowIndex) => {
    const cells = columns.map((column, index) => wrapCell(row[column], widths[index]))
    const height = Math.max(...cells.map(lines => lines.length))
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      const values = cells.map((lines, columnIndex) => (lines[lineIndex] ?? "").padEnd(widths[columnIndex]))
      let output = `| ${values.join(" | ")} |`
      if (useColor) {
        const statusColumn = columns.find(column => /status|severity|outcome/i.test(column))
        const status = statusColumn ? displayValue(row[statusColumn]).toLowerCase() : ""
        const tone = /approved|active|success|complete|resolved/.test(status) ? ansi.green
          : /reject|fail|denied|blocked|critical|error|correction/.test(status) ? ansi.red
            : /pending|draft|submitted|medium|warning/.test(status) ? ansi.orange
              : rowIndex % 2 ? ansi.alternate : ""
        if (tone) output = `${tone}${output}${ansi.reset}`
      }
      console.log(output)
    }
    if (rowIndex === rows.length - 1) console.log(paint(border, ansi.cyan))
  })
}

function loadLocalEnvironment() {
  for (const file of [".env.local", ".env.development.local", ".env"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), file), "utf8")
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match || process.env[match[1]]) continue
        let value = match[2]
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        } else {
          value = value.replace(/\s+#.*$/, "")
        }
        process.env[match[1]] = value
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

function parseArgs(args) {
  const options = { all: false, schema: false, table: null, limit: 100 }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--all") options.all = true
    else if (arg === "--schema") options.schema = true
    else if (arg === "--table") options.table = args[++index]
    else if (arg === "--limit") options.limit = Number(args[++index])
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.table === undefined) throw new Error("--table requires a table name.")
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100000) {
    throw new Error("--limit must be an integer from 1 to 100000.")
  }
  if (options.table && options.table.split(".").length > 2) throw new Error("Use TABLE or SCHEMA.TABLE for --table.")
  return options
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(help)
    return
  }

  loadLocalEnvironment()
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured. Set it in your environment or the repo's .env.local file.")
  }

  const sql = neon(process.env.DATABASE_URL)
  const databaseRows = await sql`SELECT current_database() AS database, current_schema() AS schema`
  const tables = await sql`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY table_schema, table_name
  `
  const selected = options.table
    ? (() => {
        const parts = options.table.split(".")
        const name = parts.at(-1)
        const schema = parts.length === 2 ? parts[0] : databaseRows[0]?.schema
        const found = tables.find(row => row.table_schema === schema && row.table_name === name)
        if (!found) throw new Error(`Table not found in the current schema: ${options.table}`)
        return [found]
      })()
    : tables

  console.log(`Database: ${databaseRows[0]?.database ?? "unknown"} · schema: ${databaseRows[0]?.schema ?? "unknown"}`)
  console.log(`Mode: read-only · application tables/views: ${tables.length}`)

  if (options.schema) {
    for (const table of selected) {
      const columns = await sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${table.table_schema} AND table_name = ${table.table_name}
        ORDER BY ordinal_position
      `
      renderTable(`${table.table_schema}.${table.table_name} · ${table.table_type}`, ["column_name", "data_type", "is_nullable", "column_default"], columns)
    }
  }

  if (!options.table && !options.all && !options.schema) {
    const summary = []
    for (const table of tables) {
      const identifier = `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`
      const rows = await sql.query(`SELECT count(*)::bigint AS count FROM ${identifier}`)
      summary.push({ table: `${table.table_schema}.${table.table_name}`, type: table.table_type, rows: rows[0]?.count ?? 0 })
    }
    renderTable("Database tables", ["table", "type", "rows"], summary)
    return
  }

  for (const table of selected) {
    const identifier = `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`
    const limit = options.all ? "" : ` LIMIT ${options.limit}`
    const rows = await sql.query(`SELECT * FROM ${identifier}${limit}`)
    const columns = rows.length ? Object.keys(rows[0]) : (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${table.table_schema} AND table_name = ${table.table_name}
      ORDER BY ordinal_position
    `).map(row => String(row.column_name))
    renderTable(`${table.table_schema}.${table.table_name}${options.all ? "" : ` · max ${options.limit}`}`, columns, rows)
    if (!options.all) {
      const countRows = await sql.query(`SELECT count(*)::bigint AS count FROM ${identifier}`)
      if (Number(countRows[0]?.count ?? 0) > rows.length) {
        console.log(`... output limited; table has ${countRows[0].count} rows. Add --all or increase --limit.`)
      }
    }
  }
}

export { renderTable }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`Database inspection failed: ${error.message}`)
    process.exitCode = 1
  })
}
