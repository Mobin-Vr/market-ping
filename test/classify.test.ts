import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_AFTER_SEC } from "../src/config";
import { classifyTelegramResult } from "../src/telegram/classify";
import type { TelegramApiResponse } from "../src/types";

function response(partial: Partial<TelegramApiResponse>): TelegramApiResponse {
  return {
    ok: false,
    status: 400,
    result: null,
    errorCode: null,
    description: null,
    retryAfterSec: null,
    ...partial,
  };
}

describe("classifyTelegramResult", () => {
  it("treats successful calls as sent", () => {
    expect(classifyTelegramResult(response({ ok: true, status: 200 })).outcome).toBe("sent");
  });

  it("treats 'message is not modified' as sent so edits stay idempotent", () => {
    const result = classifyTelegramResult(
      response({ status: 400, errorCode: 400, description: "Bad Request: message is not modified" }),
    );
    expect(result.outcome).toBe("sent");
  });

  it("treats 403 and blocked-word 400s as blocked", () => {
    expect(
      classifyTelegramResult(
        response({ status: 403, errorCode: 403, description: "Forbidden: bot was blocked by the user" }),
      ).outcome,
    ).toBe("blocked");
    expect(
      classifyTelegramResult(response({ status: 400, description: "Bad Request: chat not found" })).outcome,
    ).toBe("blocked");
    expect(
      classifyTelegramResult(response({ status: 403, description: "Forbidden: user is deactivated" })).outcome,
    ).toBe("blocked");
  });

  it("uses parameters.retry_after for 429", () => {
    const result = classifyTelegramResult(
      response({ status: 429, errorCode: 429, description: "Too Many Requests: retry after 7", retryAfterSec: 7 }),
    );
    expect(result.outcome).toBe("rate_limited");
    expect(result.retryAfterSec).toBe(7);
  });

  it("falls back to the default backoff when retry_after is absent", () => {
    const result = classifyTelegramResult(
      response({ status: 429, errorCode: 429, description: "Too Many Requests" }),
    );
    expect(result.outcome).toBe("rate_limited");
    expect(result.retryAfterSec).toBe(DEFAULT_RETRY_AFTER_SEC);
  });

  it("treats network failures and 5xx as transient", () => {
    expect(classifyTelegramResult(response({ status: 0, description: "TypeError" })).outcome).toBe("transient");
    expect(classifyTelegramResult(response({ status: 502 })).outcome).toBe("transient");
  });

  it("treats any other error as failed", () => {
    expect(
      classifyTelegramResult(response({ status: 400, description: "Bad Request: message text is empty" })).outcome,
    ).toBe("failed");
  });
});
