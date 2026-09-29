/**
 * Structured logging. NEVER pass secrets, tokens or full URLs containing keys here.
 * Use safeUrlForLog() when a URL has to be logged.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logEvent(event: string, fields: LogFields = {}): void {
  try {
    console.log(JSON.stringify({ ev: event, ts: Math.floor(Date.now() / 1000), ...fields }));
  } catch {
    console.log(JSON.stringify({ ev: event }));
  }
}

/** Short, secret-free error name (message text is truncated). */
export function errorName(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message.slice(0, 160)}`;
  }
  return String(err).slice(0, 160);
}

/** Strips query string and hash so API keys in URLs never reach the logs. */
export function safeUrlForLog(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
