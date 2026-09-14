export type TimeEntry = {
  id: string
  contractor: string
  /** ISO date string: YYYY-MM-DD */
  date: string
  hours: number
  project: string
  description: string
}

/** Shape returned by the AI parser (no client id yet). */
export type ParsedEntry = Omit<TimeEntry, "id">
