import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const { readClientData } = vi.hoisted(() => ({ readClientData: vi.fn() }))
vi.mock("@/lib/client-data-cache", () => ({
  readClientData,
  invalidateClientData: vi.fn(),
}))

import { AccountProfile } from "./account-profile"

beforeEach(() => {
  readClientData.mockImplementation((path: string) => Promise.resolve(
    path.includes("/api/people")
      ? { identity: { companyCode: "DEVONCALL", shortReference: "TN-000009", employeeId: "000009" } }
      : { profile: { displayName: "Maurice Baraza", imageDataUrl: null } },
  ))
})

it("keeps company identifiers off the header and organizes copyable details in the profile menu", async () => {
  render(<AccountProfile email="maurice@example.com" fallbackName="Maurice Baraza" role="Administrator" />)

  await screen.findByRole("button", { name: "Edit profile" })
  expect(screen.queryByText("TN-000009")).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
  expect(await screen.findByText("TN-000009")).toBeVisible()
  expect(screen.getByText("000009")).toBeVisible()

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  fireEvent.click(screen.getByRole("button", { name: "Copy employee id" }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Employee ID copied."))
})
