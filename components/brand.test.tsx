/**
 * Checks the TanovoTime product identity without replacing the parent organization.
 * Authentication still advertises Microsoft sign-in and never adds a password field.
 * Rendering uses local fixtures; it does not contact Microsoft or modify accounts.
 */
import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
vi.mock("@/app/actions", () => ({ signOutAction: vi.fn() }))
import { Brand } from "./brand"
import { AuthScreen } from "./auth-screen"

it("shows TanovoTime alongside the DevOnCall parent organization", () => {
  render(<Brand />)
  expect(screen.getByText("TanovoTime")).toBeVisible()
  expect(screen.getByText("DevOnCall")).toBeVisible()
})

it("uses the rebranded sign-in title and retains the Microsoft action", () => {
  render(<AuthScreen action={async () => {}} />)
  expect(screen.getByRole("heading",{name:"Sign in to TanovoTime"})).toBeVisible()
  expect(screen.getByRole("button",{name:"Sign in with Microsoft"})).toBeVisible()
  expect(document.querySelector('input[type="password"]')).toBeNull()
})
