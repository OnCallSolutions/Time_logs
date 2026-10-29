import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { TeamsTranscriptSources } from "./teams-transcript-sources"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("lists connected organizers and lets an admin pause capture", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ sources: [{
      ownerEmail: "patron@example.test",
      connectedAccount: "organizer@example.test",
      connectedAt: "2026-10-20T12:00:00.000Z",
      captureEnabled: true,
      subscriptionActive: true,
      subscriptionExpiresAt: "2026-10-21T12:00:00.000Z",
    }] }))
    .mockResolvedValueOnce(Response.json({ ownerEmail: "patron@example.test", captureEnabled: false }))
  vi.stubGlobal("fetch", fetch)

  render(<TeamsTranscriptSources />)
  expect(await screen.findByText("organizer@example.test")).toBeVisible()
  expect(screen.getByText(/does not select an entire Team or channel/)).toBeVisible()
  fireEvent.click(screen.getByRole("checkbox", { name: "Pause capture for organizer@example.test" }))

  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Enable capture for organizer@example.test" })).not.toBeChecked())
  expect(fetch).toHaveBeenLastCalledWith("/api/admin/teams-transcript-sources", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ ownerEmail: "patron@example.test", enabled: false }),
  }))
})

it("explains how organizers become available when none are connected", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sources: [] })))
  render(<TeamsTranscriptSources />)
  expect(await screen.findByText(/No organizer accounts are connected yet/)).toBeVisible()
})
