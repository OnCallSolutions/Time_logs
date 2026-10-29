/**
 * Exercises the reviewer-request confirmation window with synthetic browser data.
 * Verifies encryption precedes mutation and missing device keys fail closed.
 * Real envelope interoperability is covered separately by message crypto tests.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { ReviewerHelpDialog } from "./reviewer-help-dialog"
import type { useMessageEncryption } from "./use-message-encryption"
import type { TimeEntry } from "@/lib/types"

const entries: TimeEntry[] = [{ id: "source", revision: "revision", ownerEmail: "sender@example.com", contractor: "Sender", project: "Delivery", date: "2026-10-15", description: "Work", hours: 2, status: "submitted" }]
afterEach(() => vi.unstubAllGlobals())

/**
 * Mounts a real dialog with deterministic network and encryption dependencies.
 * @param encrypt - Synthetic envelope producer or missing-key rejection.
 * @returns Call spies for the mutation boundary and completion callback.
 */
function setup(encrypt = vi.fn().mockResolvedValue({ ciphertext: "encrypted-only" })) {
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "POST" ? { count: 1 } : { reviewers: [{ email: "reviewer@example.com" }] }))
  vi.stubGlobal("fetch", request)
  const complete = vi.fn()
  render(<ReviewerHelpDialog entries={entries} email="sender@example.com" encryption={{ unlocked: true, encrypt } as unknown as ReturnType<typeof useMessageEncryption>} onClose={vi.fn()} onComplete={complete} />)
  return { request, complete, encrypt }
}

it("encrypts the reason before sending and never includes plaintext in the request", async () => {
  const { request, complete, encrypt } = setup()
  await screen.findByRole("option", { name: /reviewer@example.com/ })
  await userEvent.selectOptions(screen.getByLabelText("Receiving manager"), "reviewer@example.com")
  await userEvent.type(screen.getByLabelText("Request reason"), "Private review reason")
  expect(request.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0)
  await userEvent.click(screen.getByRole("button", { name: "Grant scoped access and send" }))
  expect(encrypt).toHaveBeenCalledWith(expect.stringContaining("Private review reason"), "reviewer@example.com", ["sender@example.com", "reviewer@example.com"])
  const post = request.mock.calls.find(call => call[1]?.method === "POST")!
  expect(post[1]?.body).not.toContain("Private review reason")
  expect(JSON.parse(post[1]?.body as string).selection).toEqual([{ id: "source", revision: "revision" }])
  expect(complete).toHaveBeenCalledOnce()
})

it("preserves the reason and grants nothing if recipient encryption keys are missing", async () => {
  const { request, complete } = setup(vi.fn().mockRejectedValue(new Error("Recipient has no secure device.")))
  await screen.findByRole("option", { name: /reviewer@example.com/ })
  await userEvent.selectOptions(screen.getByLabelText("Receiving manager"), "reviewer@example.com")
  await userEvent.type(screen.getByLabelText("Request reason"), "Please assist")
  await userEvent.click(screen.getByRole("button", { name: "Grant scoped access and send" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("no secure device")
  expect(screen.getByLabelText("Request reason")).toHaveValue("Please assist")
  expect(request.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0)
  expect(complete).not.toHaveBeenCalled()
})
