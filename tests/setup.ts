/**
 * Loads test-wide DOM matchers and cleanup behavior.
 *
 * Keeping this in one setup file lets every component test use jest-dom matchers
 * such as toBeInTheDocument without repeating imports in each spec.
 */
import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
  cleanup()
})
