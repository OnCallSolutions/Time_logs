/**
 * Lists public database tables from the local Neon connection.
 *
 * This diagnostic script reads DATABASE_URL from .env.local instead of the
 * process environment so it behaves like the local Next.js app during debugging.
 */
const fs = require("fs")
const { neon } = require("@neondatabase/serverless")

/**
 * Reads DATABASE_URL from the local environment file for script usage.
 *
 * The parser keeps the value after the first equals sign intact so URLs with
 * query strings are handled correctly. Surrounding quotes are stripped for
 * compatibility with common .env formatting.
 *
 * @returns The DATABASE_URL value from .env.local.
 */
function readDatabaseUrl() {
  const env = fs.readFileSync(".env.local", "utf8")
  const line = env
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("DATABASE_URL="))

  if (!line) {
    throw new Error("DATABASE_URL was not found in .env.local")
  }

  const value = line.split("=").slice(1).join("=").trim()
  return value.replace(/^"|"$/g, "")
}

/**
 * Prints the public Neon database tables visible to the configured connection.
 *
 * The query reads information_schema rather than app-specific tables, making it
 * useful for checking whether migrations or table bootstrap logic have actually
 * run against the expected database.
 *
 * @returns A promise that resolves after table names are printed.
 */
async function main() {
  const sql = neon(readDatabaseUrl())
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `

  console.table(rows)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
