import { render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ProjectManagement } from "./project-management"

afterEach(() => vi.unstubAllGlobals())

it("stretches project management across a full-screen window when requested", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ projects: [], assignments: [], patrons: [] }))))
  const { container, rerender } = render(<ProjectManagement canManage canCreate fullWidth />)
  await screen.findByText("No projects yet. Create a project to begin logging time.")
  expect(container.querySelector("section")).toHaveClass("w-full", "max-w-none")
  expect(container.querySelector("section")).not.toHaveClass("max-w-6xl")

  rerender(<ProjectManagement canManage canCreate />)
  expect(container.querySelector("section")).toHaveClass("mx-auto", "max-w-6xl")
})
