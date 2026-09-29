import { DEFAULT_RETRY_AFTER_SEC } from "../config";
import type { TelegramApiResponse } from "../types";

export type SendOutcome = "sent" | "blocked" | "rate_limited" | "transient" | "failed";

export interface Classification {
  outcome: SendOutcome;
  /** Only for outcome = "rate_limited": seconds to wait before retrying. */
  retryAfterSec: number | null;
  reason: string;
}

/** Telegram error descriptions that mean "this chat can never be reached again". */
const BLOCKED_PATTERNS = [
  "bot was blocked by the user",
  "bot was kicked",
  "user is deactivated",
  "chat not found",
  "bot can't initiate conversation with a user",
  "peer id invalid",
];

/** HTTP statuses worth a retry through the queue re-enqueue path. */
const TRANSIENT_STATUSES = [500, 502, 503, 504];

/**
 * Maps a Telegram API response to a broadcast outcome.
 * 403 / blocked-word descriptions -> blocked (unsubscribe, count as blocked)
 * 429 -> rate_limited with parameters.retry_after (verified in the Bot API docs)
 * 5xx / network / timeout -> transient (re-enqueue until QUEUE_MAX_ATTEMPTS)
 * "message is not modified" -> treated as sent (edit calls are idempotent)
 */
export function classifyTelegramResult(response: TelegramApiResponse): Classification {
  if (response.ok) return { outcome: "sent", retryAfterSec: null, reason: "ok" };

  const description = (response.description ?? "").toLowerCase();

  if (description.includes("message is not modified")) {
    return { outcome: "sent", retryAfterSec: null, reason: "not-modified" };
  }
  if (response.status === 0) {
    return { outcome: "transient", retryAfterSec: null, reason: response.description ?? "network" };
  }
  if (response.status === 429) {
    return {
      outcome: "rate_limited",
      retryAfterSec: response.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC,
      reason: "429",
    };
  }
  if (response.status === 403 || BLOCKED_PATTERNS.some((pattern) => description.includes(pattern))) {
    return { outcome: "blocked", retryAfterSec: null, reason: description || `HTTP ${response.status}` };
  }
  if (TRANSIENT_STATUSES.includes(response.status)) {
    return { outcome: "transient", retryAfterSec: null, reason: `HTTP ${response.status}` };
  }
  return { outcome: "failed", retryAfterSec: null, reason: description || `HTTP ${response.status}` };
}
