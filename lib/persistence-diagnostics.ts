const sqlStateHints: Record<string, string> = {
  "23502": "required_value_missing",
  "23503": "related_record_missing",
  "23505": "duplicate_record",
  "23514": "constraint_rejected_value",
  "22P02": "invalid_value_format",
  "40001": "concurrent_transaction_retryable",
  "42501": "database_permission_denied",
  "42703": "database_column_missing",
  "42P01": "database_table_missing",
  "57014": "database_query_cancelled",
}

function safeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}

/** Produces bounded, PII-reduced server diagnostics for a failed persistence operation. */
export function persistenceFailureDetails(error: unknown): Record<string, string> {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {}
  const code = typeof source.code === "string" && /^[A-Z0-9]{5}$/.test(source.code)
    ? source.code
    : "unavailable"
  const message = safeText(source.message ?? error, 240)
  const details: Record<string, string> = {
    databaseCode: code,
    category: sqlStateHints[code] ?? "database_or_transport_error",
  }
  const name = safeText(source.name, 80)
  const constraint = safeText(source.constraint, 120)
  const table = safeText(source.table, 120)
  const column = safeText(source.column, 120)
  if (name) details.errorName = name
  if (message) details.message = message
  if (constraint) details.constraint = constraint
  if (table) details.table = table
  if (column) details.column = column
  return details
}
