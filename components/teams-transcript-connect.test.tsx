import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { TeamsTranscriptConnect } from "./teams-transcript-connect"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("shows the linked organizer account and subscription state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    connected: true,
    connectedAccount: "organizer@example.test",
    connectedAt: "2026-10-19T12:00:00.000Z",
    attendeeIdentityEnabled: true,
    subscriptionActive: true,
    subscriptionExpiresAt: "2026-10-20T12:00:00.000Z",
  })))

  render(<TeamsTranscriptConnect />)
  expect(await screen.findByText(/Connected: organizer@example\.test/)).toBeVisible()
  expect(screen.getByText(/Transcript notifications active/)).toBeVisible()
  expect(screen.getByRole("button", { name: "Reconnect Teams" })).toBeEnabled()
})

it("offers a connect action when no work account is linked", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    connected: false,
    connectedAccount: null,
    connectedAt: null,
    attendeeIdentityEnabled: false,
    subscriptionActive: false,
    subscriptionExpiresAt: null,
  })))

  render(<TeamsTranscriptConnect />)
  expect(await screen.findByText(/Connect your work account/)).toBeVisible()
  expect(screen.getByRole("button", { name: "Connect Teams" })).toBeEnabled()
})

it("offers manual queue processing only when the development server authorizes it", async () => {
  const fetch = vi.fn(async () => Response.json({
    connected: true,
    connectedAccount: "organizer@example.test",
    connectedAt: "2026-10-19T12:00:00.000Z",
    attendeeIdentityEnabled: true,
    subscriptionActive: true,
    subscriptionExpiresAt: null,
    developmentProcessingAvailable: true,
  }))
  vi.stubGlobal("fetch", fetch)

  render(<TeamsTranscriptConnect />)
  const processButton = await screen.findByRole("button", { name: "Process queued transcripts" })
  expect(processButton).toBeEnabled()
  expect(screen.getByRole("button", { name: "Reconnect Teams" })).toBeEnabled()
})

it("searches a selected date range for older organizer transcripts", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({
      connected: true,
      connectedAccount: "organizer@example.test",
      connectedAt: "2026-10-19T12:00:00.000Z",
      attendeeIdentityEnabled: true,
      subscriptionActive: true,
      subscriptionExpiresAt: null,
      developmentProcessingAvailable: false,
    }))
    .mockResolvedValueOnce(Response.json({ found: 1, meetingsChecked: 1, queued: 1, duplicates: 0, truncated: false }))
  vi.stubGlobal("fetch", fetch)

  render(<TeamsTranscriptConnect />)
  fireEvent.click(await screen.findByRole("button", { name: "Find past transcripts" }))

  expect(await screen.findByRole("status")).toHaveTextContent("Checked 1 meetings and found 1 past transcript; queued 1 for processing.")
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch.mock.calls[1][0]).toContain("/api/teams/transcripts/backfill")
})
