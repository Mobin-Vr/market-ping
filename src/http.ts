import { FETCH_RETRIES, FETCH_TIMEOUT_MS } from "./config";

export interface HttpOutcome {
  ok: boolean;
  status: number;
  latencyMs: number;
  /** null when the request completed, otherwise "Timeout", "TypeError:ECONNRESET", ... */
  errorName: string | null;
  text: string;
}

export interface HttpJsonOutcome<T> extends Omit<HttpOutcome, "text"> {
  attempts: number;
  data: T | null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "Timeout";
    const cause = (err as { cause?: { code?: string } }).cause;
    return cause?.code ? `${err.name}:${cause.code}` : err.name;
  }
  return "UnknownError";
}

/** GET with a hard timeout. Never throws: failures come back as ok=false. */
export async function fetchText(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<HttpOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...options.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, errorName: null, text };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, errorName: describeError(err), text: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET + JSON.parse with FETCH_RETRIES retries. 4xx responses are not retried (except 429)
 * to stay inside the 50-subrequest-per-invocation free-plan budget.
 */
export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<HttpJsonOutcome<T>> {
  const retries = options.retries ?? FETCH_RETRIES;
  let last: HttpOutcome | null = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    attempts += 1;
    const outcome = await fetchText(url, options);
    last = outcome;
    if (outcome.ok) {
      try {
        return { ...outcome, attempts, data: JSON.parse(outcome.text) as T };
      } catch {
        return { ...outcome, ok: false, attempts, data: null, errorName: "InvalidJson" };
      }
    }
    if (outcome.status >= 400 && outcome.status < 500 && outcome.status !== 429) break;
  }
  return {
    ok: false,
    status: last?.status ?? 0,
    latencyMs: last?.latencyMs ?? 0,
    errorName: last?.errorName ?? null,
    attempts,
    data: null,
  };
}

/** Human-readable HTTP outcome for the admin API-health panel. */
export function describeHttpOutcome(outcome: { status: number; errorName: string | null }): string {
  if (outcome.status === 0) return outcome.errorName ?? "network error";
  return `HTTP ${outcome.status}`;
}
