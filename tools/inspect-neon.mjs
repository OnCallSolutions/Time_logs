import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
The URL is never printed. This script runs SELECT queries only. Output may contain
personal or confidential records; handle terminal logs and redirected files accordingly.
`

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

function jsonLine(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)
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
      console.log(`\n${table.table_schema}.${table.table_name} (${table.table_type})`)
      for (const column of columns) {
        console.log(`  ${column.column_name} · ${column.data_type}${column.is_nullable === "NO" ? " · required" : ""}${column.column_default ? ` · default ${column.column_default}` : ""}`)
      }
    }
  }

  if (!options.table && !options.all && !options.schema) {
    console.log("\nTABLE                           TYPE       ROWS")
    for (const table of tables) {
      const identifier = `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`
      const rows = await sql.query(`SELECT count(*)::bigint AS count FROM ${identifier}`)
      const label = `${table.table_schema}.${table.table_name}`
      console.log(`${label.padEnd(32)} ${String(table.table_type).padEnd(10)} ${rows[0]?.count ?? 0}`)
    }
    return
  }

  for (const table of selected) {
    const identifier = `${quoteIdentifier(table.table_schema)}.${quoteIdentifier(table.table_name)}`
    const limit = options.all ? "" : ` LIMIT ${options.limit}`
    const rows = await sql.query(`SELECT * FROM ${identifier}${limit}`)
    console.log(`\n--- ${table.table_schema}.${table.table_name} (${rows.length}${options.all ? "" : `, max ${options.limit}`} rows) ---`)
    for (const row of rows) console.log(jsonLine(row))
    if (!options.all) {
      const countRows = await sql.query(`SELECT count(*)::bigint AS count FROM ${identifier}`)
      if (Number(countRows[0]?.count ?? 0) > rows.length) {
        console.log(`... output limited; table has ${countRows[0].count} rows. Add --all or increase --limit.`)
      }
    }
  }
}

main().catch(error => {
  console.error(`Database inspection failed: ${error.message}`)
  process.exitCode = 1
})
