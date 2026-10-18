/**
 * Maps each server-side AI workflow to its independently configurable Gateway model.
 * Defaults favor structured output, low latency, and the catalog's all-endpoint
 * zero-data-retention option; deployment overrides remain server-only.
 */

export const AI_WORKFLOW_MODELS = {
  assistant: { env: "ASSISTANT_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  timesheetExtraction: { env: "TIMESHEET_EXTRACTION_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  submissionPreparation: { env: "SUBMISSION_PREPARATION_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  timesheetReview: { env: "TIMESHEET_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  accountReview: { env: "ACCOUNT_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
  securityMonitoring: { env: "SECURITY_REVIEW_MODEL", defaultModel: "openai/gpt-5.4-mini" },
} as const

export type AiWorkflow = keyof typeof AI_WORKFLOW_MODELS

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
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(configured)) {
    throw new Error(`Invalid model configuration for ${configuration.env}`)
  }
  return configured
}
