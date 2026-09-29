import { afterEach, describe, expect, it, vi } from "vitest";
import { handleScheduled } from "../src/broadcast/cron";
import { CHUNK_SIZE, SNAPSHOT_RETENTION_DAYS } from "../src/config";
import { createFakeD1, createFakeQueue, fakeEnv, jsonResponse, stubNetwork, type FakeRoute } from "./fakes";
import { FIXTURE_NOW, rawFixtures } from "./fixtures";

const NOW = FIXTURE_NOW;
const HOUR_KEY = "2026-09-29-10";
const ADMIN_ID = 555;
const DAY_SEC = 86_400;

const HEALTHY = {
  nerkh: () => jsonResponse(rawFixtures.nerkh),
  navasan: () => jsonResponse(rawFixtures.navasan),
  megaweb: () => jsonResponse(rawFixtures.megaweb),
  zipodo: () => jsonResponse(rawFixtures.zipodo),
};

const toUserRow = (entry: number | { chatId: number; lang: "fa" | "en" }): { chat_id: number; lang: string } =>
  typeof entry === "number" ? { chat_id: entry, lang: "fa" } : { chat_id: entry.chatId, lang: entry.lang };

function routes(
  recipients: Array<number | { chatId: number; lang: "fa" | "en" }>,
  claimChanges = 1,
  settingsValue = "1",
  overrides: readonly FakeRoute[] = [],
): readonly FakeRoute[] {
  return [
    ["SELECT value FROM settings WHERE key", { first: { value: settingsValue } }],
    ["SELECT chat_id, lang FROM users", { all: recipients.map(toUserRow) }],
    ["INSERT OR IGNORE INTO broadcast_log", { changes: claimChanges }],
    ["UPDATE broadcast_log SET status", { changes: 1 }],
    ["UPDATE broadcast_log", { changes: 1 }],
    ["FROM last_good", { all: [] }],
    ["INSERT INTO snapshots", { lastRowId: 42 }],
    ["DELETE FROM snapshots", { changes: 2 }],
    ...overrides,
  ];
}

function paramsOf(statements: Array<{ sql: string; params: unknown[] }>, fragment: string): unknown[] | null {
  const found = statements.find((statement) => statement.sql.includes(fragment));
  return found ? found.params : null;
}

function countStatements(statements: Array<{ sql: string }>, fragment: string): number {
  return statements.filter((statement) => statement.sql.includes(fragment)).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleScheduled", () => {
  it("does nothing outside the 09:00-21:00 Tehran window", async () => {
    const network = stubNetwork({ sources: HEALTHY });
    const fake = createFakeD1(routes([11]));
    const queue = createFakeQueue();
    // 08:00 Tehran == 04:30 UTC
    await handleScheduled(
      fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }),
      Date.parse("2026-09-29T04:30:00Z"),
    );
    expect(countStatements(fake.statements, "INSERT OR IGNORE INTO broadcast_log")).toBe(0);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(0);
    expect(queue.batches).toHaveLength(0);
    expect(network.telegramCalls).toHaveLength(0);
  });

  it("does not run while the service is OFF", async () => {
    stubNetwork({ sources: HEALTHY });
    const fake = createFakeD1(routes([11], 1, "0"));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);
    expect(countStatements(fake.statements, "INSERT OR IGNORE INTO broadcast_log")).toBe(0);
    expect(queue.batches).toHaveLength(0);
  });

  it("is idempotent: an already claimed hour does no work", async () => {
    stubNetwork({ sources: HEALTHY });
    const fake = createFakeD1(routes([11, 12], 0));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(0);
    expect(queue.batches).toHaveLength(0);
  });

  it("claims the hour, stores one snapshot and enqueues the subscribers in chunks", async () => {
    stubNetwork({ sources: HEALTHY });
    const recipients = Array.from({ length: 40 }, (_, index) => 1000 + index);
    const fake = createFakeD1(routes(recipients));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);

    expect(paramsOf(fake.statements, "INSERT OR IGNORE INTO broadcast_log")).toEqual([HOUR_KEY, NOW, 40]);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(1);
    expect(queue.batches).toHaveLength(1);
    const chunks = queue.batches[0];
    expect(chunks.map((chunk) => chunk.chatIds.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 10]);
    expect(
      chunks.every(
        (chunk) => chunk.snapshotId === 42 && chunk.hourKey === HOUR_KEY && chunk.attempt === 1,
      ),
    ).toBe(true);
    // Persian is the default, so every chunk of this run is Persian.
    expect(chunks.every((chunk) => chunk.lang === "fa")).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.chatIds)).toEqual(recipients);
    expect(paramsOf(fake.statements, "DELETE FROM snapshots")).toEqual([
      NOW - SNAPSHOT_RETENTION_DAYS * DAY_SEC,
    ]);
  });

  it("chunks per language and never mixes languages in one message", async () => {
    stubNetwork({ sources: HEALTHY });
    const fa = Array.from({ length: 20 }, (_, index) => ({ chatId: 100 + index, lang: "fa" as const }));
    const en = Array.from({ length: 20 }, (_, index) => ({ chatId: 300 + index, lang: "en" as const }));
    const fake = createFakeD1(routes([...fa, ...en]));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);

    expect(paramsOf(fake.statements, "INSERT OR IGNORE INTO broadcast_log")).toEqual([HOUR_KEY, NOW, 40]);
    const chunks = queue.batches.flat();
    const faChunks = chunks.filter((chunk) => chunk.lang === "fa");
    const enChunks = chunks.filter((chunk) => chunk.lang === "en");
    expect(faChunks).toHaveLength(2);
    expect(enChunks).toHaveLength(2);
    expect(faChunks.flatMap((chunk) => chunk.chatIds)).toEqual(fa.map((target) => target.chatId));
    expect(enChunks.flatMap((chunk) => chunk.chatIds)).toEqual(en.map((target) => target.chatId));
    for (const chunk of chunks) {
      const isFaRange = chunk.chatIds.every((chatId) => chatId < 300);
      expect(chunk.lang).toBe(isFaRange ? "fa" : "en");
    }
  });

  it("splits more than 100 chunk messages into several sendBatch calls", async () => {
    stubNetwork({ sources: HEALTHY });
    const recipients = Array.from({ length: 1600 }, (_, index) => 2000 + index);
    const fake = createFakeD1(routes(recipients));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);
    expect(queue.batches.map((batch) => batch.length)).toEqual([100, 7]);
    expect(queue.batches.flat()).toHaveLength(Math.ceil(1600 / CHUNK_SIZE));
  });

  it("marks the hour done when there are no subscribers", async () => {
    stubNetwork({ sources: HEALTHY });
    const fake = createFakeD1(routes([]));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);
    expect(paramsOf(fake.statements, "UPDATE broadcast_log SET status")).toEqual([HOUR_KEY, "done"]);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(0);
    expect(queue.batches).toHaveLength(0);
  });

  it("skips the broadcast and alerts the admins when every source fails", async () => {
    const network = stubNetwork();
    const fake = createFakeD1(routes([11, 12]));
    const queue = createFakeQueue();
    await handleScheduled(
      fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue, ADMIN_IDS: String(ADMIN_ID) }),
      NOW * 1000,
    );

    expect(paramsOf(fake.statements, "UPDATE broadcast_log SET status")).toEqual([HOUR_KEY, "skipped"]);
    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(0);
    expect(queue.batches).toHaveLength(0);
    expect(network.telegramCalls).toHaveLength(1);
    expect(network.telegramCalls[0].chatId).toBe(ADMIN_ID);
    expect(network.telegramCalls[0].text).toContain("All price sources failed");
    expect(network.telegramCalls[0].text).toContain("Broadcast skipped");
  });

  it("still broadcasts partial data, with N/A for the missing metrics", async () => {
    const network = stubNetwork({ sources: { zipodo: HEALTHY.zipodo } });
    const fake = createFakeD1(routes([11]));
    const queue = createFakeQueue();
    await handleScheduled(fakeEnv({ DB: fake.db, BROADCAST_QUEUE: queue.queue }), NOW * 1000);

    expect(countStatements(fake.statements, "INSERT INTO snapshots")).toBe(1);
    expect(queue.batches).toHaveLength(1);
    expect(network.telegramCalls).toHaveLength(0);
    const stored = fake.statements.find((statement) => statement.sql.includes("INSERT INTO snapshots"));
    expect(String(stored?.params[2])).toContain("Market Ping");
    expect(String(stored?.params[2])).toContain("~249,950 T");
  });
});
