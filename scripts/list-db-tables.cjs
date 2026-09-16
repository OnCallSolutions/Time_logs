const fs = require("fs")
const { neon } = require("@neondatabase/serverless")

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
