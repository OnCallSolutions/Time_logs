/**
 * Central production routing table for all server-side AI calls.
 *
 * Model IDs use the AI Gateway `provider/model` format. Keep this configuration
 * server-only: callers may select a workflow in code, but requests from a browser
 * must never be allowed to choose a model, provider, fallback, or credential.
 * Extraction uses the strongest currently available OpenAI reasoning model by
 * default because transcription and messy-note parsing are the product's core
 * workflow. Gateway retries that workflow on the listed fallback only when its
 * primary model/provider route cannot complete; it does not change any app rules.
 */
import "server-only"
import { createOpenAI } from "@ai-sdk/openai"

export const AI_WORKFLOW_MODELS = {
  assistant: { env: "ASSISTANT_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  timesheetExtraction: {
    env: "TIMESHEET_EXTRACTION_MODEL",
    defaultModel: "openai/gpt-6.1-sol",
    fallbackModels: ["openai/gpt-5.6-sol"],
    fallbackEnv: "TIMESHEET_EXTRACTION_FALLBACK_MODELS",
  },
  submissionPreparation: { env: "SUBMISSION_PREPARATION_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  timesheetReview: { env: "TIMESHEET_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  accountReview: { env: "ACCOUNT_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  securityMonitoring: { env: "SECURITY_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
} as const

export type AiWorkflow = keyof typeof AI_WORKFLOW_MODELS
export type AiProvider = "gateway" | "openai"

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i

/**
 * Resolves an AI workflow's configured model without exposing credentials.
 * @param workflow - Server-side feature making the model call.
 * @returns AI Gateway provider/model identifier.
 * @throws Error when a deployment override is not a provider/model identifier.
 */
export function getAiModel(workflow: AiWorkflow): string {
  const configuration = AI_WORKFLOW_MODELS[workflow]
  const configured = process.env[configuration.env]?.trim()
  if (!configured) return configuration.defaultModel
  if (!MODEL_ID_PATTERN.test(configured)) {
    throw new Error(`Invalid model configuration for ${configuration.env}`)
  }
  return configured
}

/**
 * Chooses the server-side model route. Gateway remains the default; setting
 * AI_PROVIDER=openai uses the server-configured OpenAI API key directly and
 * never sends requests through Gateway or its system-credential fallback.
 */
export function getAiProvider(): AiProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (!configured || configured === "gateway") return "gateway"
  if (configured === "openai") return "openai"
  throw new Error("Invalid AI_PROVIDER configuration; use gateway or openai")
}

/**
 * Creates an AI SDK language model for one workflow without exposing its API
 * key. Workflow model settings retain the Gateway `provider/model` form; direct
 * OpenAI mode strips only the known `openai/` provider prefix.
 */
export function getAiModelForWorkflow(workflow: AiWorkflow) {
  const configuredModel = getAiModel(workflow)
  if (getAiProvider() === "gateway") return configuredModel
  if (!configuredModel.startsWith("openai/")) {
    throw new Error(`The ${workflow} model must use the openai/ provider when AI_PROVIDER=openai`)
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai")
  return createOpenAI({ apiKey })(configuredModel.slice("openai/".length))
}

/**
 * Gets the ordered Gateway model failover list for a workflow.
 *
 * An optional comma-separated environment override makes operations able to
 * change failover without a code release. Empty/duplicate entries are removed,
 * malformed model IDs fail closed, and the primary model is never repeated as
 * its own fallback. Workflows without an explicit fallback remain single-model.
 */
export function getAiModelFallbacks(workflow: AiWorkflow): string[] {
  const configuration = AI_WORKFLOW_MODELS[workflow]
  if (!("fallbackModels" in configuration)) return []

  const fallbackEnv = "fallbackEnv" in configuration ? configuration.fallbackEnv : undefined
  const configured = fallbackEnv ? process.env[fallbackEnv]?.trim() : undefined
  const candidates = configured
    ? configured.split(",").map(model => model.trim()).filter(Boolean)
    : configuration.fallbackModels
  const primary = getAiModel(workflow)
  const fallbacks = [...new Set(candidates)]

  if (fallbacks.some(model => !MODEL_ID_PATTERN.test(model))) {
    throw new Error(`Invalid fallback model configuration for ${fallbackEnv}`)
  }

  return fallbacks.filter(model => model !== primary)
}

/**
 * Builds optional AI SDK provider options shared by model call sites.
 *
 * AI Gateway reads `gateway.models` as ordered model-level failover targets;
 * provider-level routing and authentication continue to be managed by Gateway.
 * Returning an empty object keeps non-extraction workflows on their single
 * explicitly configured model.
 */
export function getAiProviderOptions(workflow: AiWorkflow) {
  if (getAiProvider() === "openai") return undefined
  const models = getAiModelFallbacks(workflow)
  return models.length ? { gateway: { models } } : undefined
}
