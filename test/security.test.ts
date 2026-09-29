import { describe, expect, it } from "vitest";
import { WEBHOOK_PATH_PREFIX, WEBHOOK_SECRET_HEADER } from "../src/config";
import { extractWebhookSecret, isWebhookAuthorized, parseAdminIds, safeEqual } from "../src/security";

const SECRET = "s3cret-path-value";

function webhookRequest(pathSecret: string, headerSecret: string | null): Request {
  const headers = new Headers();
  if (headerSecret !== null) headers.set(WEBHOOK_SECRET_HEADER, headerSecret);
  return new Request(`https://bot.example.workers.dev/telegram/${pathSecret}`, { method: "POST", headers });
}

describe("safeEqual", () => {
  it("compares equal, different and different-length values", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("parseAdminIds", () => {
  it("parses comma separated numeric ids and ignores junk", () => {
    expect(parseAdminIds("123, 456 , 789")).toEqual([123, 456, 789]);
    expect(parseAdminIds("")).toEqual([]);
    expect(parseAdminIds(undefined)).toEqual([]);
    expect(parseAdminIds("abc, -5, 0, 42")).toEqual([42]);
  });
});

describe("webhook authorization", () => {
  it("accepts matching path and header secrets", () => {
    expect(extractWebhookSecret(`${WEBHOOK_PATH_PREFIX}${SECRET}`, WEBHOOK_PATH_PREFIX)).toBe(SECRET);
    expect(isWebhookAuthorized(webhookRequest(SECRET, SECRET), SECRET, SECRET)).toBe(true);
  });

  it("rejects a missing or wrong header secret", () => {
    expect(isWebhookAuthorized(webhookRequest(SECRET, null), SECRET, SECRET)).toBe(false);
    expect(isWebhookAuthorized(webhookRequest(SECRET, "nope"), SECRET, SECRET)).toBe(false);
  });

  it("rejects a wrong path secret", () => {
    expect(isWebhookAuthorized(webhookRequest("wrong", SECRET), SECRET, "wrong")).toBe(false);
  });

  it("rejects extra path segments and empty secrets", () => {
    expect(extractWebhookSecret("/telegram/a/b", WEBHOOK_PATH_PREFIX)).toBeNull();
    expect(extractWebhookSecret("/telegram/", WEBHOOK_PATH_PREFIX)).toBeNull();
    expect(extractWebhookSecret("/", WEBHOOK_PATH_PREFIX)).toBeNull();
    expect(isWebhookAuthorized(webhookRequest(SECRET, SECRET), "", SECRET)).toBe(false);
  });
});
