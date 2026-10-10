/**
 * Tests concurrent and failed schema initialization without a live database.
 * These cases ensure cold requests avoid duplicated setup and can recover after
 * a transient database outage without restarting the application server.
 */
import { expect, it, vi } from "vitest"
import { createDatabaseInitializer } from "./database-initializer"

it("shares concurrent setup and caches successful initialization",async()=>{
  const run=createDatabaseInitializer()
  const setup=vi.fn(async()=>{})
  const first=run(setup)
  expect(run(setup)).toBe(first)
  await first
  await run(setup)
  expect(setup).toHaveBeenCalledTimes(1)
})

it("retries a failed initialization without hiding the failure",async()=>{
  const run=createDatabaseInitializer()
  const setup=vi.fn().mockRejectedValueOnce(new Error("Transient failure")).mockResolvedValue(undefined)
  await expect(run(setup)).rejects.toThrow("Transient failure")
  await run(setup)
  expect(setup).toHaveBeenCalledTimes(2)
})
