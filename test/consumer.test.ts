import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgress, processBroadcastMessage, retryDelaySec } from "../src/broadcast/consumer";
import { DEFAULT_RETRY_AFTER_SEC, QUEUE_MAX_ATTEMPTS } from "../src/config";
import type { BroadcastMessage } from "../src/types";
import { createFakeD1, createFakeMessage, createFakeQueue, fakeEnv, stubNetwork, type FakeRoute } from "./fakes";

const HOUR_KEY = "2026-09-29-10";

const SNAPSHOT_ROW = {
  id: 7,
  created_at: 1000,
  hour_key: HOUR_KEY,
  message_html: "<b>snapshot</b>",
  data_json: "{}",
};

const DEFAULT_ROUTES: readonly FakeRoute[] = [
  ["FROM snapshots WHERE id", { first: SNAPSHOT_ROW }],
  ["UPDATE users SET blocked", { changes: 1 }],
  ["UPDATE broadcast_log", { changes: 1 }],
];

function body(chatIds: number[], attempt = 1): BroadcastMessage {
  return { snapshotId: 7, hourKey: HOUR_KEY, chatIds, attempt };
}

/** Parameters of the atomic counter statement: [hourKey, sent, blocked, failed]. */
function counterParams(statements: Array<{ sql: string; params: unknown[] }>): unknown[] | null {
  const found = statements.find((statement) => statement.sql.includes("sent = sent +"));
  return found ? found.params : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retryDelaySec", () => {
  it("uses Telegram's retry_after when it was provided", () => {
    const progress = { ...createProgress(), retryAfterSec: 9 };
    expect(retryDelaySec(progress, 1)).toBe(9);
  });

  it("falls back to a linear backoff", () => {
    expect(retryDelaySec(createProgress(), 1)).toBe(DEFAULT_RETRY_AFTER_SEC);
    expect(retryDelaySec(createProgress(), 2)).toBe(DEFAULT_RETRY_AFTER_SEC * 2);
  });
});

describe("processBroadcastMessage", () => {
  it("sends every chat of the chunk and counts them as sent", async () => {
    stubNetwork();
    const fake = createFakeD1(DEFAULT_ROUTES);
    const { message, state } = createFakeMessage(body([11, 12, 13]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);

    expect(state.acked).toBe(true);
    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 3, 0, 0]);
  });

  it("unsubscribes a chat that blocked the bot and counts it as blocked", async () => {
    stubNetwork({
      telegram: (call) =>
        call.chatId === 12
          ? { ok: false, status: 403, errorCode: 403, description: "Forbidden: bot was blocked by the user" }
          : { ok: true },
    });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const { message, state } = createFakeMessage(body([11, 12, 13]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);

    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 2, 1, 0]);
    const blocked = fake.statements.find((statement) => statement.sql.includes("UPDATE users SET blocked"));
    expect(blocked?.params[0]).toBe(12);
    expect(state.acked).toBe(true);
  });

  it("counts non-retryable errors as failed", async () => {
    stubNetwork({
      telegram: (call) =>
        call.chatId === 13
          ? { ok: false, status: 400, description: "Bad Request: message text is empty" }
          : { ok: true },
    });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const { message } = createFakeMessage(body([11, 12, 13]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);

    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 2, 0, 1]);
  });

  it("stops on 429, re-enqueues only the remaining ids with retry_after and acks after the enqueue", async () => {
    stubNetwork({
      telegram: (call) =>
        call.chatId === 12
          ? { ok: false, status: 429, errorCode: 429, description: "Too Many Requests: retry after 9", retryAfterSec: 9 }
          : { ok: true },
    });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const queue = createFakeQueue();
    const { message, state } = createFakeMessage(body([11, 12, 13, 14]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), message);

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].body.chatIds).toEqual([12, 13, 14]);
    expect(queue.sent[0].body.attempt).toBe(2);
    expect(queue.sent[0].delaySeconds).toBe(9);
    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 1, 0, 0]);
    expect(state.acked).toBe(true);
  });

  it("never re-enqueues a chat that was already delivered", async () => {
    stubNetwork({
      telegram: (call) =>
        call.chatId === 12 || call.chatId === 13
          ? { ok: false, status: 429, errorCode: 429, description: "Too Many Requests", retryAfterSec: 3 }
          : { ok: true },
    });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const queue = createFakeQueue();
    const { message } = createFakeMessage(body([11, 12, 13, 14]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), message);

    const followUp = queue.sent[0].body.chatIds;
    expect(followUp).toEqual([12, 13, 14]);
    expect(followUp).not.toContain(11);
    expect(new Set(followUp).size).toBe(followUp.length);
  });

  it("does not acknowledge the original when the follow-up enqueue fails", async () => {
    stubNetwork({
      telegram: () => ({ ok: false, status: 429, errorCode: 429, description: "Too Many Requests", retryAfterSec: 7 }),
    });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const failingQueue = {
      send: async () => {
        throw new Error("queue unavailable");
      },
      sendBatch: async () => undefined,
    } as unknown as Queue<BroadcastMessage>;
    const { message, state } = createFakeMessage(body([11, 12]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: failingQueue }), message);

    expect(state.acked).toBe(false);
    expect(state.retries).toBe(1);
    expect(state.retryDelay).toBe(7);
  });

  it("re-enqueues transient failures with the default backoff while attempts remain", async () => {
    stubNetwork({ telegram: () => ({ ok: false, status: 503 }) });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const queue = createFakeQueue();
    const { message, state } = createFakeMessage(body([11, 12]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), message);

    expect(queue.sent[0].delaySeconds).toBe(DEFAULT_RETRY_AFTER_SEC);
    expect(queue.sent[0].body.chatIds).toEqual([11, 12]);
    expect(counterParams(fake.statements)).toBeNull();
    expect(state.acked).toBe(true);
  });

  it("gives up after the attempt cap and counts the remainder as failed", async () => {
    stubNetwork({ telegram: () => ({ ok: false, status: 503 }) });
    const fake = createFakeD1(DEFAULT_ROUTES);
    const queue = createFakeQueue();
    const { message, state } = createFakeMessage(body([11, 12, 13, 14], QUEUE_MAX_ATTEMPTS));

    await processBroadcastMessage(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), message);

    expect(queue.sent).toHaveLength(0);
    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 0, 0, 4]);
    expect(state.acked).toBe(true);
  });

  it("acks and counts the subscribers as failed when the snapshot is gone", async () => {
    stubNetwork();
    const fake = createFakeD1([
      ["FROM snapshots WHERE id", {}],
      ["UPDATE broadcast_log", { changes: 1 }],
    ]);
    const { message, state } = createFakeMessage(body([11, 12]));

    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);

    expect(counterParams(fake.statements)).toEqual([HOUR_KEY, 0, 0, 2]);
    expect(state.acked).toBe(true);
  });

  it("ignores an invalid body", async () => {
    const network = stubNetwork();
    const fake = createFakeD1(DEFAULT_ROUTES);
    const invalid = { hourKey: HOUR_KEY, chatIds: [1], attempt: 1 } as unknown as BroadcastMessage;
    const { message, state } = createFakeMessage(invalid);

    await processBroadcastMessage(fakeEnv({ DB: fake.db }), message);

    expect(state.acked).toBe(true);
    expect(network.telegramCalls).toHaveLength(0);
  });
});
