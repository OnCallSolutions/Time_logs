import { afterEach, describe, expect, it, vi } from "vitest"
const { createOpenAI } = vi.hoisted(() => ({
  createOpenAI: vi.fn((options: { apiKey: string }) => (modelId: string) => ({ provider: "openai", modelId, apiKey: options.apiKey })),
}))
vi.mock("@ai-sdk/openai", () => ({ createOpenAI }))
import { AI_WORKFLOW_MODELS, getAiModel, getAiModelFallbacks, getAiModelForWorkflow, getAiProvider, getAiProviderOptions } from "./ai-models"

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
    expect(getAiModel("timesheetExtraction")).toBe("openai/gpt-6.1-sol")
    expect(getAiModelFallbacks("timesheetExtraction")).toEqual(["openai/gpt-5.6-sol"])
    expect(getAiProviderOptions("timesheetExtraction")).toEqual({ gateway: { models: ["openai/gpt-5.6-sol"] } })
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

  it("accepts ordered fallback overrides and excludes duplicates and the primary model", () => {
    vi.stubEnv("TIMESHEET_EXTRACTION_MODEL", "openai/gpt-5.6-sol")
    vi.stubEnv("TIMESHEET_EXTRACTION_FALLBACK_MODELS", "openai/gpt-5.6-sol, anthropic/claude-sonnet-5, openai/gpt-5.6-sol")
    expect(getAiModelFallbacks("timesheetExtraction")).toEqual(["anthropic/claude-sonnet-5"])
  })

  it("rejects malformed fallback overrides rather than routing to an arbitrary URL", () => {
    vi.stubEnv("TIMESHEET_EXTRACTION_FALLBACK_MODELS", "https://example.com/model")
    expect(() => getAiModelFallbacks("timesheetExtraction")).toThrow("Invalid fallback model configuration")
  })

  it("does not configure failover for ordinary advisory workflows", () => {
    expect(getAiModelFallbacks("assistant")).toEqual([])
    expect(getAiProviderOptions("assistant")).toBeUndefined()
  })

  it("keeps Gateway as the default provider", () => {
    expect(getAiProvider()).toBe("gateway")
    expect(getAiModelForWorkflow("timesheetExtraction")).toBe("openai/gpt-6.1-sol")
  })

  it("routes directly to OpenAI with the server key and disables Gateway fallbacks", () => {
    vi.stubEnv("AI_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "test-only-secret")
    expect(getAiProvider()).toBe("openai")
    expect(getAiModelForWorkflow("timesheetExtraction")).toEqual({ provider: "openai", modelId: "gpt-6.1-sol", apiKey: "test-only-secret" })
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "test-only-secret" })
    expect(getAiProviderOptions("timesheetExtraction")).toBeUndefined()
  })

  it("fails closed if direct OpenAI is selected without a server key", () => {
    vi.stubEnv("AI_PROVIDER", "openai")
    vi.stubEnv("OPENAI_API_KEY", "")
    expect(() => getAiModelForWorkflow("timesheetExtraction")).toThrow("OPENAI_API_KEY is required")
  })

  it("rejects unsupported providers and non-OpenAI models in direct mode", () => {
    vi.stubEnv("AI_PROVIDER", "unknown")
    expect(() => getAiProvider()).toThrow("use gateway or openai")
    vi.stubEnv("AI_PROVIDER", "openai")
    vi.stubEnv("TIMESHEET_REVIEW_MODEL", "anthropic/claude-sonnet-5.5")
    vi.stubEnv("OPENAI_API_KEY", "test-only-secret")
    expect(() => getAiModelForWorkflow("timesheetReview")).toThrow("must use the openai/ provider")
  })
})
