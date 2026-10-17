import { expect, it } from "vitest"
import { persistenceFailureDetails } from "./persistence-diagnostics"

it("classifies common PostgreSQL persistence failures and removes sensitive values", () => {
  expect(persistenceFailureDetails({
    name: "NeonDbError",
    code: "23514",
    message: "Bad value for person@example.com, record 123e4567-e89b-42d3-a456-426614174000",
    constraint: "time_entries_status_check",
    table: "time_entries",
  })).toEqual({
    databaseCode: "23514",
    category: "constraint_rejected_value",
    errorName: "NeonDbError",
    message: "Bad value for [email], record [id]",
    constraint: "time_entries_status_check",
    table: "time_entries",
  })
})

it("keeps unknown transport errors bounded without exposing credential URLs", () => {
  const result = persistenceFailureDetails({
    message: `fetch failed for postgresql://user:secret@db.example/app ${"x".repeat(1000)}`,
  })
  expect(result.databaseCode).toBe("unavailable")
  expect(result.category).toBe("database_or_transport_error")
  expect(result.message).not.toContain("secret")
  expect(result.message?.length).toBeLessThanOrEqual(240)
})
