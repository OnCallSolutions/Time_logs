import "server-only"

export const integrationProviders = {
  microsoft_graph: { origin: "https://graph.microsoft.com", apiRoot: "/v1.0" },
} as const

export type IntegrationProvider = keyof typeof integrationProviders
export type IntegrationMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type IntegrationCall = {
  provider: IntegrationProvider
  operation: string
  path: string
  method: IntegrationMethod
  accessToken: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  timeoutMs?: number
}

export type IntegrationErrorDiagnostic = {
  provider: IntegrationProvider
  operation: string
  method: IntegrationMethod
  path: string
  status: number | null
  code: string
  requestId: string | null
}

/** Sanitized upstream failure; response bodies and credentials are deliberately omitted. */
export class IntegrationApiError extends Error {
  readonly diagnostic: IntegrationErrorDiagnostic

  constructor(diagnostic: IntegrationErrorDiagnostic) {
    super(`${diagnostic.provider} ${diagnostic.operation} failed${diagnostic.status ? ` with HTTP ${diagnostic.status}` : ""} (${diagnostic.code}).`)
    this.name = "IntegrationApiError"
    this.diagnostic = diagnostic
  }
}

function safeUpstreamCode(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) return null
  return value
}

function requestId(response: Response): string | null {
  const value = response.headers.get("request-id") ?? response.headers.get("x-ms-request-id") ?? response.headers.get("client-request-id")
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null
}

/** Makes one bounded, allowlisted HTTPS call without retrying non-idempotent work. */
export async function callIntegrationApi<T>(call: IntegrationCall): Promise<T> {
  const provider = integrationProviders[call.provider]
  if (!provider) throw new Error("Unsupported integration provider.")
  if (!call.accessToken.trim()) throw new Error("An integration access token is required.")
  if (!/^[a-z][a-z0-9_.-]{1,80}$/i.test(call.operation)) throw new Error("Invalid integration operation name.")
  if (!call.path.startsWith("/") || call.path.startsWith("//") || call.path.includes("\\") || /[?#]/.test(call.path) || call.path.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Integration paths must be relative API paths without traversal or query strings.")
  }
  if ((call.method === "GET" || call.method === "DELETE") && call.body !== undefined) throw new Error("This integration method cannot include a request body.")

  const url = new URL(`${provider.apiRoot}${call.path}`, provider.origin)
  if (url.origin !== provider.origin) throw new Error("Integration destination is not allowlisted.")
  for (const [key, value] of Object.entries(call.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value))

  const timeoutMs = Math.min(Math.max(call.timeoutMs ?? 12_000, 1_000), 30_000)
  let response: Response
  try {
    response = await fetch(url, {
      method: call.method,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${call.accessToken}`,
        ...(call.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError"
    throw new IntegrationApiError({ provider: call.provider, operation: call.operation, method: call.method, path: call.path, status: null, code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR", requestId: null })
  }

  if (!response.ok) {
    let upstreamCode: string | null = null
    try {
      const payload = await response.json() as { error?: { code?: unknown }; code?: unknown }
      upstreamCode = safeUpstreamCode(payload.error?.code) ?? safeUpstreamCode(payload.code)
    } catch { /* Non-JSON upstream bodies are intentionally discarded. */ }
    throw new IntegrationApiError({ provider: call.provider, operation: call.operation, method: call.method, path: call.path, status: response.status, code: upstreamCode ?? `HTTP_${response.status}`, requestId: requestId(response) })
  }

  if (response.status === 204) return undefined as T
  return await response.json() as T
}
