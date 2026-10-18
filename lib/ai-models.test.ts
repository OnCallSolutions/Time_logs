import { afterEach, describe, expect, it, vi } from "vitest"
import { AI_WORKFLOW_MODELS, getAiModel } from "./ai-models"

afterEach(() => vi.unstubAllEnvs())

describe("AI workflow model routing", () => {
  it("provides an independent configured model slot for every AI workflow", () => {
    const settings = Object.values(AI_WORKFLOW_MODELS).map(model => model.env)
    expect(settings).toEqual([
      "ASSISTANT_MODEL",
      "TIMESHEET_EXTRACTION_MODEL",
      "SUBMISSION_PREPARATION_MODEL",
      "TIMESHEET_REVIEW_MODEL",
      "ACCOUNT_REVIEW_MODEL",
      "SECURITY_REVIEW_MODEL",
    ])
    expect(new Set(settings).size).toBe(settings.length)
  })

  it("uses the workflow default when no override is set", () => {
    expect(getAiModel("timesheetExtraction")).toBe("openai/gpt-5.4-mini")
  })

  it("honors a valid workflow-specific override", () => {
    vi.stubEnv("TIMESHEET_REVIEW_MODEL", "anthropic/claude-sonnet-5.5")
    expect(getAiModel("timesheetReview")).toBe("anthropic/claude-sonnet-5.5")
    expect(getAiModel("accountReview")).toBe("openai/gpt-5.4-mini")
  })

  it("rejects URLs and malformed model identifiers instead of silently routing elsewhere", () => {
    vi.stubEnv("ASSISTANT_MODEL", "https://example.com/model")
    expect(() => getAiModel("assistant")).toThrow("Invalid model configuration for ASSISTANT_MODEL")
  })
})
