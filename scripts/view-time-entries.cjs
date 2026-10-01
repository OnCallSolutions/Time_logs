/**
 * Prints recent time entry rows from the local Neon connection.
 *
 * This diagnostic script is meant for local inspection of saved data. It reads
 * the same .env.local DATABASE_URL as the app and prints the newest rows in a
 * table-friendly shape.
 */
const fs = require("fs")
const { neon } = require("@neondatabase/serverless")

/**
 * Reads DATABASE_URL from the local environment file for script usage.
 *
 * The parser preserves everything after DATABASE_URL= so connection strings with
 * embedded equals signs or query parameters are not truncated.
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
 * Prints recent time entries from Neon for local inspection.
 *
 * The output includes owner_email so role and per-user scoping issues can be
 * debugged without opening the database console.
 *
 * @returns A promise that resolves after recent entries are printed.
 */
async function main() {
  const sql = neon(readDatabaseUrl())
  const rows = await sql`
    select
      id,
      contractor,
      work_date,
      hours,
      project,
      description,
      owner_email,
      created_at
    from time_entries
    order by created_at desc
    limit 500
  `

  console.table(rows)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
