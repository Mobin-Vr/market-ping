import { describe, expect, it } from "vitest";
import { buildQueueMessages, chunkChatIds, splitSendBatches } from "../src/broadcast/chunk";
import { CHUNK_SIZE, QUEUE_MAX_MESSAGES_PER_SEND_BATCH } from "../src/config";

describe("chunkChatIds", () => {
  it("splits ids into chunks of CHUNK_SIZE and keeps the order", () => {
    const ids = Array.from({ length: 34 }, (_, index) => 1000 + index);
    const chunks = chunkChatIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(4);
    expect(chunks.flat()).toEqual(ids);
  });

  it("handles empty input, a custom size and a non-positive size", () => {
    expect(chunkChatIds([])).toEqual([]);
    expect(chunkChatIds([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkChatIds([1], 0)).toEqual([[1]]);
  });
});

describe("buildQueueMessages", () => {
  it("builds one message per chunk carrying snapshot id, hour key and attempt", () => {
    const messages = buildQueueMessages(7, "2026-09-29-10", [1, 2, 3], 2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      snapshotId: 7,
      hourKey: "2026-09-29-10",
      chatIds: [1, 2, 3],
      attempt: 2,
    });
  });

  it("defaults the attempt number to 1", () => {
    expect(buildQueueMessages(1, "k", [1])[0].attempt).toBe(1);
  });
});

describe("splitSendBatches", () => {
  it("never exceeds 100 messages per sendBatch call", () => {
    const messages = Array.from({ length: 250 }, (_, index) => index);
    const batches = splitSendBatches(messages);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(messages);
    expect(QUEUE_MAX_MESSAGES_PER_SEND_BATCH).toBe(100);
  });

  it("returns no batch for an empty list and keeps small lists intact", () => {
    expect(splitSendBatches([])).toEqual([]);
    expect(splitSendBatches([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});
