import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { MessageAdminRecovery } from "./message-admin-recovery"

afterEach(() => vi.unstubAllGlobals())

it("checks enrolled devices and recovers only after choosing a target and confirming", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, devices: [{ deviceId: "Office laptop", fingerprint: "fp-123" }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ restored: 50, unavailable: 2, next: { date: "2026-10-01", id: "message-50" } })))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  render(<MessageAdminRecovery />)
  await user.click(screen.getByRole("button", { name: "Organization history recovery" }))
  await user.type(screen.getByRole("textbox", { name: "Account email" }), "casey@example.com")
  await user.click(screen.getByRole("button", { name: "Check registered devices" }))
  expect(await screen.findByRole("option", { name: "Office laptop" })).toBeInTheDocument()
  const confirm = screen.getByRole("button", { name: "Confirm history recovery" })
  expect(confirm).toBeDisabled()
  await user.selectOptions(screen.getByRole("combobox", { name: "Receiving device" }), "fp-123")
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("50 messages restored; 2 have no recovery envelope. More history remains."))
  expect(fetch.mock.calls[0][0]).toContain("email=casey%40example.com")
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({ email: "casey@example.com", target: "fp-123", before: null })
  expect(screen.getByRole("button", { name: "Recover next history page" })).toBeEnabled()
})

it("keeps the recovery window open with a visible error when device lookup fails", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No authorized devices" }), { status: 403 }))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  render(<MessageAdminRecovery />)
  await user.click(screen.getByRole("button", { name: "Organization history recovery" }))
  await user.type(screen.getByRole("textbox", { name: "Account email" }), "casey@example.com")
  await user.click(screen.getByRole("button", { name: "Check registered devices" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("No authorized devices")
  expect(screen.getByRole("dialog", { name: "Organization history recovery" })).toBeVisible()
  expect(fetch).toHaveBeenCalledOnce()
})
