import { WEBHOOK_SECRET_HEADER } from "./config";

/** Length-independent, constant-time-ish string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** "123, 456" -> [123, 456]; non-numeric entries are ignored. */
export function parseAdminIds(raw: string | undefined | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

/** Secret path segment of /telegram/<WEBHOOK_SECRET>. */
export function extractWebhookSecret(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

/**
 * Both the secret path and the X-Telegram-Bot-Api-Secret-Token header must match.
 * Returns false for every other case (the caller answers 401).
 */
export function isWebhookAuthorized(
  request: Request,
  expectedSecret: string,
  providedSecret: string | null,
): boolean {
  if (!expectedSecret || !providedSecret) return false;
  if (!safeEqual(providedSecret, expectedSecret)) return false;
  const header = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!header) return false;
  return safeEqual(header, expectedSecret);
}
