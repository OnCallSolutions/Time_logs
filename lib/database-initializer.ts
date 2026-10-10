/**
 * Coordinates lazy database schema setup within a server process.
 * Concurrent requests share one initialization attempt, while transient failures
 * remain retryable on the next request instead of poisoning the process cache.
 */

/**
 * Creates an independent promise cache for one schema initialization operation.
 * @returns Function accepting a setup callback and returning its shared completion promise.
 */
export function createDatabaseInitializer() {
  let pending: Promise<void> | undefined
  return (initialize: () => Promise<void>): Promise<void> => {
    pending ??= Promise.resolve().then(initialize).catch(error => {
      pending = undefined
      throw error
    })
    return pending
  }
}
